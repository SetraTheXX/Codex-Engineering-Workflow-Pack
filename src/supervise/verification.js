"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getWorktreeChangeSummary, findScopeWarnings } = require("../lib/scope-check");
const { readJsonFile } = require("../lib/json");
const { assertPolicyAllows } = require("../run/policy");
const { makeFailureSignature, runApprovedCommand, writeBoundedLog } = require("./commands");
const { pauseForBudget } = require("./budget");
const { appendEvent, findSupervisedRun, getNextAction, writeCanonicalRun } = require("./state");
const { getTestAuthoringVerdict } = require("./test-authoring");

function classifyFailure(result, signature, baseline) {
  if (!signature) return "pass";
  if (result.timedOut || /ENOENT|not recognized|not found|MODULE_NOT_FOUND|network|ECONN/i.test(`${result.stdout}\n${result.stderr}`)) {
    return "environment-dependency";
  }
  if (baseline && baseline.failureSignature === signature) return "pre-existing";
  return "new-regression";
}

function runVerificationSet({
  stage,
  commands,
  worktreePath,
  runRoot,
  timeoutSeconds,
  maxOutputBytes,
  baselineRuns = [],
  startIndex = 0,
}) {
  const outputRoot = path.join(runRoot, "verification");
  fs.mkdirSync(outputRoot, { recursive: true });
  const runs = [];
  let capturedBytes = 0;

  commands.forEach((command, index) => {
    const result = runApprovedCommand(command, {
      cwd: worktreePath,
      timeoutSeconds,
      maxOutputBytes: Math.max(0, maxOutputBytes - capturedBytes),
    });
    const number = startIndex + index + 1;
    const stdoutPath = path.join(outputRoot, `${stage}-${number}-stdout.log`);
    const stderrPath = path.join(outputRoot, `${stage}-${number}-stderr.log`);
    const stdoutCapture = writeBoundedLog(stdoutPath, result.stdout, Math.max(0, maxOutputBytes - capturedBytes));
    capturedBytes += stdoutCapture.capturedBytes;
    const stderrCapture = writeBoundedLog(stderrPath, result.stderr, Math.max(0, maxOutputBytes - capturedBytes));
    capturedBytes += stderrCapture.capturedBytes;
    const failureSignature = makeFailureSignature(result, worktreePath);
    const baseline = baselineRuns.find((entry) => entry.command === command);
    runs.push({
      id: `${stage}-${number}`,
      stage,
      command,
      status: failureSignature ? "fail" : "pass",
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      classification: classifyFailure(result, failureSignature, baseline),
      failureSignature,
      logs: {
        stdout: path.relative(runRoot, stdoutPath).replace(/\\/g, "/"),
        stderr: path.relative(runRoot, stderrPath).replace(/\\/g, "/"),
        stdoutCapture,
        stderrCapture,
      },
    });
  });
  return { runs, capturedBytes };
}

function captureBaseline({ run, runRoot, worktreePath, timeoutSeconds }) {
  return runVerificationSet({
    stage: "baseline",
    commands: run.tasks[0].verification.targeted,
    worktreePath,
    runRoot,
    timeoutSeconds,
    maxOutputBytes: run.budget.maxCapturedOutputBytes.value - run.budget.consumed.capturedOutputBytes,
  });
}

function updateOwnershipStatus(runRoot, status) {
  const ownershipPath = path.join(runRoot, "ownership.json");
  const ownership = readJsonFile(ownershipPath, "execution ownership");
  const temporaryPath = `${ownershipPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ ...ownership, status }, null, 2)}\n`);
  fs.renameSync(temporaryPath, ownershipPath);
  return ownership;
}

function pauseForVerificationBudget(found, allocation, reason) {
  const now = new Date();
  pauseForBudget(found, allocation, {
    allowed: false,
    reason,
    pauseStatus: "paused-budget-unverified",
    warning: "local-verification-budget-exhausted",
  }, now);
  throw new Error(`Controlled verification paused: paused-budget-unverified (${reason}).`);
}

function verifySupervisedCheckpoint(options = {}) {
  const found = findSupervisedRun(options);
  const task = found.run.tasks[0];
  if (found.run.status !== "verifying" || task.status !== "awaiting-verification") {
    throw new Error(`Checkpoint cannot verify from run=${found.run.status}, task=${task.status}.`);
  }
  assertPolicyAllows(found.repoRoot, "runCommands");
  const ownership = readJsonFile(path.join(found.runRoot, "ownership.json"), "execution ownership");
  if (ownership.owner !== "managed" || ownership.backend !== "codex-exec" || ownership.status !== "active") {
    throw new Error("Managed ownership is not active for this checkpoint.");
  }
  if (!fs.existsSync(ownership.worktree.path)) {
    throw new Error(`Managed worktree is missing: ${ownership.worktree.path}`);
  }

  const commands = task.verification.targeted;
  const consumedRuns = found.run.budget.consumed.targetedVerificationRuns;
  if (consumedRuns + commands.length > found.run.budget.maxTargetedVerificationRuns.value) {
    pauseForVerificationBudget(found, "targeted-verification", "targeted-verification-budget-exhausted");
  }
  const consumedFullRuns = found.run.budget.consumed.fullVerificationRuns;
  if (
    task.verification.full.length > 0
    && consumedFullRuns + task.verification.full.length > found.run.budget.maxFullVerificationRuns.value
  ) {
    pauseForVerificationBudget(found, "full-verification", "full-verification-budget-exhausted");
  }
  const baselineRuns = task.verification.runs.filter((entry) => entry.stage === "baseline");
  const targetedResult = runVerificationSet({
    stage: "targeted",
    commands,
    worktreePath: ownership.worktree.path,
    runRoot: found.runRoot,
    timeoutSeconds: options.timeoutSeconds,
    maxOutputBytes: found.run.budget.maxCapturedOutputBytes.value
      - found.run.budget.consumed.capturedOutputBytes,
    baselineRuns,
    startIndex: task.verification.runs.filter((entry) => entry.stage === "targeted").length,
  });
  const targetedPassed = targetedResult.runs.every((entry) => entry.status === "pass");
  let fullResult = { runs: [], capturedBytes: 0 };
  if (targetedPassed && task.verification.full.length > 0) {
    fullResult = runVerificationSet({
      stage: "full",
      commands: task.verification.full,
      worktreePath: ownership.worktree.path,
      runRoot: found.runRoot,
      timeoutSeconds: options.timeoutSeconds,
      maxOutputBytes: Math.max(
        0,
        found.run.budget.maxCapturedOutputBytes.value
          - found.run.budget.consumed.capturedOutputBytes
          - targetedResult.capturedBytes,
      ),
      startIndex: task.verification.runs.filter((entry) => entry.stage === "full").length,
    });
  }
  const result = {
    runs: [...targetedResult.runs, ...fullResult.runs],
    capturedBytes: targetedResult.capturedBytes + fullResult.capturedBytes,
  };
  const changes = getWorktreeChangeSummary(ownership.worktree.path, found.run.repo.baseCommit);
  const scopeWarnings = findScopeWarnings(task.id, changes.changedFiles, task);
  if (changes.committedDiffError) scopeWarnings.push(changes.committedDiffError.message);
  const testAuthoring = getTestAuthoringVerdict(found.run, changes.changedFiles);
  const failures = result.runs.filter((entry) => entry.status === "fail");
  const passed = failures.length === 0
    && scopeWarnings.length === 0
    && testAuthoring.status === "pass";
  const observedAt = new Date().toISOString();
  const failureHistory = [
    ...(task.verification.failures || []),
    ...failures.map((entry) => ({
      verificationId: entry.id,
      signature: entry.failureSignature,
      classification: entry.classification,
      observedAt,
    })),
  ];
  const repeated = failures.some((failure) => (
    failureHistory.filter((entry) => entry.signature === failure.failureSignature).length >= 2
  ));
  const policyBlocked = testAuthoring.status === "fail";
  const blocked = !passed && (repeated || policyBlocked);
  const run = {
    ...found.run,
    status: passed ? "checkpoint-complete" : blocked ? "blocked" : "needs-repair",
    updatedAt: observedAt,
    budget: JSON.parse(JSON.stringify(found.run.budget)),
    tasks: [{
      ...task,
      status: passed ? "verified" : blocked ? "blocked" : "repair-ready",
      verification: {
        ...task.verification,
        runs: [...task.verification.runs, ...result.runs],
        failures: failureHistory,
        latest: result.runs.at(-1) || null,
        scope: {
          status: scopeWarnings.length === 0 ? "pass" : "fail",
          warnings: scopeWarnings,
        },
        testAuthoring,
      },
      evidence: passed
        ? [...task.evidence, {
          type: "verification",
          verificationIds: result.runs.map((entry) => entry.id),
          scopeStatus: "pass",
        }]
        : task.evidence,
      blocker: blocked ? {
        code: policyBlocked ? "test-authoring-policy-violation" : "repeated-verification-failure",
        reasons: policyBlocked
          ? testAuthoring.violations
          : failures.map((entry) => `${entry.classification}: ${entry.failureSignature}`),
        actions: ["revise", "rollback", "abandon"],
      } : null,
    }],
  };
  run.budget.consumed.targetedVerificationRuns += commands.length;
  run.budget.consumed.fullVerificationRuns += fullResult.runs.length;
  run.budget.consumed.capturedOutputBytes += result.capturedBytes;
  writeCanonicalRun(found.runRoot, run);
  if (passed) updateOwnershipStatus(found.runRoot, "verified");
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: observedAt,
    type: passed ? "checkpoint-verified" : blocked ? "verification-blocked" : "verification-failed",
    runId: found.runId,
    checkpointId: task.id,
    result: passed ? "pass" : "fail",
    failureSignatures: failures.map((entry) => entry.failureSignature),
    classifications: failures.map((entry) => entry.classification),
    scopeStatus: scopeWarnings.length === 0 ? "pass" : "fail",
    testAuthoringStatus: testAuthoring.status,
    testAuthoringViolations: testAuthoring.violations,
  });
  return { ok: passed, run, runRoot: found.runRoot, nextAction: getNextAction(run) };
}

module.exports = {
  captureBaseline,
  classifyFailure,
  runVerificationSet,
  verifySupervisedCheckpoint,
};
