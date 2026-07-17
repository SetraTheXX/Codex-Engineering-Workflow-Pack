"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonFile } = require("../lib/json");
const { assertPolicyAllows } = require("../run/policy");
const {
  didAdapterTimeOut,
  getAdapterExitCode,
  runCodexExecAdapter,
} = require("../run/adapters/codex-exec");
const { validateOwnershipRecord } = require("../run/ownership");
const {
  ensureOperationBudget,
  mergeManagedUsage,
  parseManagedUsage,
  writeBoundedLog,
} = require("./execution");
const { appendEvent, findSupervisedRun, getNextAction, writeCanonicalRun } = require("./state");

function makeReviewerPrompt(run) {
  const task = run.tasks[0];
  const verification = task.verification.runs
    .filter((entry) => entry.stage !== "baseline")
    .map((entry) => `- ${entry.command}: ${entry.status} (${entry.classification})`)
    .join("\n");
  return `# CEWP Dispatch Prompt - Reviewer

You are the independent reviewer. Do not edit files.

Goal: ${run.goal}
Checkpoint: ${task.id}
Allowed files: ${task.allowedFiles.join(", ")}
Changed files: ${task.attempts.at(-1).changedFiles.join(", ")}

Verification evidence:
${verification || "- none"}

Inspect the Git diff, scope, stopping conditions, and verification evidence.
Your final response must begin with exactly one decision line:

Decision: PASS
Decision: REQUEST_CHANGES
Decision: BLOCK

Use PASS only when the bounded goal, scope, and verification are satisfied.
`;
}

function parseReviewerDecision(content) {
  const match = String(content || "").match(/^\s*Decision\s*:\s*(PASS|REQUEST_CHANGES|BLOCK)\b/im);
  return match ? match[1] : null;
}

function reviewSupervisedCheckpoint(options = {}) {
  if (!options.yes) throw new Error("Independent review requires --yes.");
  const found = findSupervisedRun(options);
  const task = found.run.tasks[0];
  if (found.run.status !== "checkpoint-complete" || task.status !== "verified") {
    throw new Error(`Independent reviewer PASS is required after a verified checkpoint; current run=${found.run.status}, task=${task.status}.`);
  }
  assertPolicyAllows(found.repoRoot, "runReviewer");
  ensureOperationBudget(found.run, "reviewer");
  const ownership = validateOwnershipRecord(
    readJsonFile(path.join(found.runRoot, "ownership.json"), "execution ownership"),
  );
  if (ownership.status !== "verified" || !fs.existsSync(ownership.worktree.path)) {
    throw new Error("Independent review requires a verified managed worktree.");
  }

  const startedAt = new Date().toISOString();
  const outputRoot = path.join(found.runRoot, "review");
  fs.mkdirSync(outputRoot, { recursive: true });
  const promptPath = path.join(outputRoot, "reviewer-prompt.md");
  const stdoutPath = path.join(outputRoot, "reviewer-stdout.jsonl");
  const stderrPath = path.join(outputRoot, "reviewer-stderr.log");
  const lastMessagePath = path.join(outputRoot, "reviewer-last-message.md");
  const reportPath = path.join(outputRoot, "reviewer-report.md");
  fs.writeFileSync(promptPath, makeReviewerPrompt(found.run));

  const startedRun = {
    ...found.run,
    status: "reviewing",
    updatedAt: startedAt,
    budget: JSON.parse(JSON.stringify(found.run.budget)),
    usage: JSON.parse(JSON.stringify(found.run.usage)),
    reviewer: {
      ...found.run.reviewer,
      independent: true,
      status: "executing",
      startedAt,
    },
  };
  startedRun.budget.consumed.modelOperations += 1;
  startedRun.budget.consumed.allocations.reviewer += 1;
  startedRun.usage.managedOperations.value += 1;
  writeCanonicalRun(found.runRoot, startedRun);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: startedAt,
    type: "review-started",
    runId: found.runId,
    checkpointId: task.id,
    allocation: "reviewer",
  });

  const execResult = runCodexExecAdapter({
    worktreePath: ownership.worktree.path,
    promptPath,
    outputLastMessagePath: lastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
    sandbox: "read-only",
    structuredJson: true,
  });
  const remainingOutput = Math.max(
    0,
    startedRun.budget.maxCapturedOutputBytes.value - startedRun.budget.consumed.capturedOutputBytes,
  );
  const stdoutCapture = writeBoundedLog(stdoutPath, execResult.stdout, remainingOutput);
  const stderrCapture = writeBoundedLog(
    stderrPath,
    execResult.stderr,
    Math.max(0, remainingOutput - stdoutCapture.capturedBytes),
  );
  const exitCode = getAdapterExitCode(execResult);
  const timedOut = didAdapterTimeOut(execResult);
  const lastMessage = fs.existsSync(lastMessagePath)
    ? fs.readFileSync(lastMessagePath, "utf8")
    : "";
  const decision = parseReviewerDecision(lastMessage);
  fs.writeFileSync(reportPath, lastMessage);
  const usage = parseManagedUsage(execResult.stdout);
  const passed = exitCode === 0 && !timedOut && decision === "PASS";
  const requestChanges = exitCode === 0 && !timedOut && decision === "REQUEST_CHANGES";
  const completedAt = new Date().toISOString();
  const status = passed ? "review-passed" : requestChanges ? "review-changes" : "blocked";
  const run = {
    ...startedRun,
    status,
    updatedAt: completedAt,
    usage: {
      ...startedRun.usage,
      managedTokens: mergeManagedUsage(startedRun.usage.managedTokens, usage),
    },
    reviewer: {
      ...startedRun.reviewer,
      status: passed ? "passed" : requestChanges ? "changes-requested" : "blocked",
      decision,
      completedAt,
      exitCode,
      timedOut,
      reportPath: path.relative(found.runRoot, reportPath).replace(/\\/g, "/"),
      usage,
      reason: decision
        ? null
        : "Reviewer output did not contain a supported Decision line.",
    },
    tasks: [{
      ...task,
      status: passed ? "verified" : requestChanges ? "review-changes" : "blocked",
      evidence: decision
        ? [...task.evidence, {
          type: "independent-review",
          decision,
          path: path.relative(found.runRoot, reportPath).replace(/\\/g, "/"),
        }]
        : task.evidence,
      blocker: passed ? null : {
        code: requestChanges ? "reviewer-request-changes" : "reviewer-block",
        reasons: [decision || "missing-reviewer-decision"],
        actions: requestChanges ? ["revise", "retry", "abandon"] : ["revise", "rollback", "abandon"],
      },
    }],
  };
  run.budget.consumed.capturedOutputBytes += stdoutCapture.capturedBytes + stderrCapture.capturedBytes;
  writeCanonicalRun(found.runRoot, run);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: completedAt,
    type: passed ? "review-passed" : requestChanges ? "review-changes-requested" : "review-blocked",
    runId: found.runId,
    checkpointId: task.id,
    decision,
    exitCode,
    timedOut,
    usageLabel: usage.label,
  });
  return { ok: passed, run, runRoot: found.runRoot, nextAction: getNextAction(run) };
}

module.exports = {
  makeReviewerPrompt,
  parseReviewerDecision,
  reviewSupervisedCheckpoint,
};
