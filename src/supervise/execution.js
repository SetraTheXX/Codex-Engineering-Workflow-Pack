"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  getGitHeadCommit,
  getGitOutput,
  isRepoDirty,
} = require("../lib/git");
const {
  findScopeWarnings,
  getWorktreeChangeSummary,
} = require("../lib/scope-check");
const { evaluateControlledOperation } = require("../run/control-gates");
const {
  runCodexExecAdapter,
  getAdapterExitCode,
  didAdapterTimeOut,
} = require("../run/adapters/codex-exec");
const {
  OWNERSHIP_SCHEMA_VERSION,
  validateOwnershipRecord,
} = require("../run/ownership");
const {
  appendEvent,
  findSupervisedRun,
  getNextAction,
  writeCanonicalRun,
} = require("./state");

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function writeBoundedLog(filePath, value, maxBytes) {
  const input = Buffer.from(value || "", "utf8");
  const truncated = input.length > maxBytes;
  const output = truncated ? input.subarray(0, maxBytes) : input;
  fs.writeFileSync(filePath, output);
  return {
    capturedBytes: output.length,
    originalBytes: input.length,
    truncated,
  };
}

function parseManagedUsage(stdout) {
  const categories = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  let observations = 0;

  for (const line of String(stdout || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "turn.completed" || !event.usage || typeof event.usage !== "object") {
      continue;
    }
    const usage = event.usage;
    const values = {
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.cached_input_tokens,
      outputTokens: usage.output_tokens,
      reasoningOutputTokens: usage.reasoning_output_tokens,
    };
    if (!Object.values(values).every((value) => Number.isInteger(value) && value >= 0)) {
      continue;
    }
    categories.inputTokens += values.inputTokens;
    categories.cachedInputTokens += values.cachedInputTokens;
    categories.outputTokens += values.outputTokens;
    categories.reasoningOutputTokens += values.reasoningOutputTokens;
    observations += 1;
  }

  if (observations === 0) {
    return {
      label: "unknown",
      value: null,
      reason: "Managed process returned no valid turn.completed usage event.",
    };
  }

  return {
    label: "observed",
    source: "codex-exec-jsonl/turn.completed.usage",
    observedAt: new Date().toISOString(),
    observations,
    ...categories,
  };
}

function ensureOperationBudget(run, allocation) {
  const budget = run.budget;
  const totalConsumed = budget.consumed.modelOperations;
  const totalMaximum = budget.modelOperations.value;
  const allocationConsumed = budget.consumed.allocations[allocation];
  const allocationMaximum = budget.allocations[allocation].value;
  if (totalConsumed >= totalMaximum) {
    throw new Error("Absolute model-operation ceiling is exhausted; no controlled operation may start.");
  }
  if (allocationConsumed >= allocationMaximum) {
    throw new Error(`${allocation} model-operation allocation is exhausted; protected allocations cannot be borrowed.`);
  }
}

function getWorktreePaths(found) {
  const task = found.run.tasks[0];
  const managedRoot = path.resolve(found.repoRoot, "..", ".cewp-worktrees");
  const worktreePath = path.join(managedRoot, path.basename(found.repoRoot), found.runId, task.id);
  return {
    managedRoot,
    worktreePath,
    branch: `cewp/${found.runId}/${task.id}`,
  };
}

function createOwnedWorktree(found, startedAt) {
  if (isRepoDirty(found.repoRoot)) {
    throw new Error("Cannot dispatch a supervised checkpoint while the source repository is dirty.");
  }
  const currentHead = getGitHeadCommit(found.repoRoot);
  if (currentHead !== found.run.repo.baseCommit) {
    throw new Error("Repository HEAD changed after plan approval. Revise or recreate the supervised run.");
  }

  const paths = getWorktreePaths(found);
  if (fs.existsSync(paths.worktreePath)) {
    throw new Error(`Managed checkpoint worktree already exists: ${paths.worktreePath}`);
  }
  const branchProbe = getGitOutput(["show-ref", "--verify", "--quiet", `refs/heads/${paths.branch}`], found.repoRoot);
  if (branchProbe.status === 0) {
    throw new Error(`Managed checkpoint branch already exists: ${paths.branch}`);
  }

  fs.mkdirSync(path.dirname(paths.worktreePath), { recursive: true });
  const created = getGitOutput([
    "worktree",
    "add",
    paths.worktreePath,
    "-b",
    paths.branch,
    found.run.repo.baseCommit,
  ], found.repoRoot);
  if (created.status !== 0) {
    throw new Error(`Failed to create managed checkpoint worktree: ${(created.stderr || created.stdout || "").trim()}`);
  }

  const ownership = validateOwnershipRecord({
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    runId: found.runId,
    taskId: found.run.tasks[0].id,
    checkpointId: found.run.tasks[0].id,
    owner: "managed",
    backend: "codex-exec",
    status: "active",
    createdAt: startedAt,
    cleanupAuthority: "cewp-core",
    worktree: {
      id: `${found.runId}:${found.run.tasks[0].id}`,
      path: paths.worktreePath,
    },
  });
  const gate = evaluateControlledOperation({
    coreGate: { status: "open" },
    warningSurfaces: {
      conversation: true,
      hook: false,
      app: false,
      notification: false,
    },
    ownershipRecords: [],
    requestedOwnership: ownership,
  }, { repoRoot: found.repoRoot });
  if (!gate.allowed) {
    throw new Error(`Controlled operation blocked: ${gate.reason}`);
  }
  writeJsonAtomic(path.join(found.runRoot, "ownership.json"), ownership);
  return { ...paths, ownership };
}

function makeWorkerPrompt(run) {
  const task = run.tasks[0];
  return `# CEWP Supervised Checkpoint

Role: worker-a
Task: ${task.id}
Goal: ${run.goal}

Allowed files:
${task.allowedFiles.map((file) => `- ${file}`).join("\n")}

Forbidden files:
${task.forbiddenFiles.map((file) => `- ${file}`).join("\n")}

Stopping conditions:
${task.stoppingConditions.map((condition) => `- ${condition}`).join("\n")}

Do only this bounded checkpoint. Do not weaken tests, expand scope, merge, push, publish, or finalize.
CEWP Core will run verification and scope gates after you stop.
`;
}

function executeSupervisedCheckpoint(options = {}) {
  if (!options.yes) {
    throw new Error("Supervised execution requires --yes after reviewing the approved checkpoint.");
  }
  const found = findSupervisedRun(options);
  const task = found.run.tasks[0];
  if (found.run.status !== "approved" || task.status !== "ready") {
    throw new Error(`Checkpoint cannot execute from run=${found.run.status}, task=${task.status}.`);
  }
  ensureOperationBudget(found.run, "implementation");

  const startedAt = new Date().toISOString();
  const owned = createOwnedWorktree(found, startedAt);
  const outputRoot = path.join(found.runRoot, "adapter-output");
  fs.mkdirSync(outputRoot, { recursive: true });
  const promptPath = path.join(outputRoot, "checkpoint-1-prompt.md");
  const stdoutPath = path.join(outputRoot, "checkpoint-1-stdout.jsonl");
  const stderrPath = path.join(outputRoot, "checkpoint-1-stderr.log");
  const lastMessagePath = path.join(outputRoot, "checkpoint-1-last-message.md");
  fs.writeFileSync(promptPath, makeWorkerPrompt(found.run));

  const attempt = {
    id: "attempt-1",
    kind: "implementation",
    status: "running",
    startedAt,
    completedAt: null,
    exitCode: null,
    timedOut: false,
    changedFiles: [],
    scope: { status: "pending", warnings: [] },
    usage: { label: "unknown", value: null },
  };
  const startedRun = {
    ...found.run,
    status: "executing",
    updatedAt: startedAt,
    budget: JSON.parse(JSON.stringify(found.run.budget)),
    usage: JSON.parse(JSON.stringify(found.run.usage)),
    tasks: [{
      ...task,
      status: "executing",
      attempts: [...task.attempts, attempt],
    }],
  };
  startedRun.budget.consumed.modelOperations += 1;
  startedRun.budget.consumed.allocations.implementation += 1;
  startedRun.usage.managedOperations.value += 1;
  writeCanonicalRun(found.runRoot, startedRun);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: startedAt,
    type: "dispatch-started",
    runId: found.runId,
    checkpointId: task.id,
    attemptId: attempt.id,
    allocation: "implementation",
    owner: "managed",
    backend: "codex-exec",
  });

  const execResult = runCodexExecAdapter({
    worktreePath: owned.worktreePath,
    promptPath,
    outputLastMessagePath: lastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
    sandbox: "workspace-write",
    structuredJson: true,
  });
  const maxOutputBytes = startedRun.budget.maxCapturedOutputBytes.value;
  const stdoutLog = writeBoundedLog(stdoutPath, execResult.stdout, maxOutputBytes);
  const stderrLog = writeBoundedLog(stderrPath, execResult.stderr, maxOutputBytes);
  const exitCode = getAdapterExitCode(execResult);
  const timedOut = didAdapterTimeOut(execResult);
  const usage = parseManagedUsage(execResult.stdout);
  const changes = getWorktreeChangeSummary(owned.worktreePath, found.run.repo.baseCommit);
  const scopeWarnings = findScopeWarnings(task.id, changes.changedFiles, task);
  if (changes.committedDiffError) {
    scopeWarnings.push(changes.committedDiffError.message);
  }
  const lastMessagePresent = fs.existsSync(lastMessagePath);
  const succeeded = exitCode === 0 && !timedOut && scopeWarnings.length === 0 && lastMessagePresent;
  const completedAt = new Date().toISOString();
  const completedAttempt = {
    ...attempt,
    status: succeeded ? "completed" : "failed",
    completedAt,
    exitCode,
    timedOut,
    changedFiles: changes.changedFiles,
    scope: {
      status: scopeWarnings.length === 0 ? "pass" : "fail",
      warnings: scopeWarnings,
    },
    usage,
    logs: {
      stdout: path.relative(found.runRoot, stdoutPath).replace(/\\/g, "/"),
      stderr: path.relative(found.runRoot, stderrPath).replace(/\\/g, "/"),
      lastMessage: lastMessagePresent
        ? path.relative(found.runRoot, lastMessagePath).replace(/\\/g, "/")
        : null,
      stdoutCapture: stdoutLog,
      stderrCapture: stderrLog,
    },
  };
  const blockerReasons = [];
  if (exitCode !== 0) blockerReasons.push(`codex-exec exited with code ${exitCode}`);
  if (timedOut) blockerReasons.push(`codex-exec timed out after ${options.timeoutSeconds}s`);
  blockerReasons.push(...scopeWarnings);
  if (!lastMessagePresent) blockerReasons.push("codex-exec last message is missing");
  const completedRun = {
    ...startedRun,
    status: succeeded ? "verifying" : "blocked",
    updatedAt: completedAt,
    usage: {
      ...startedRun.usage,
      managedTokens: usage,
    },
    tasks: [{
      ...startedRun.tasks[0],
      status: succeeded ? "awaiting-verification" : "blocked",
      attempts: [completedAttempt],
      blocker: succeeded ? null : {
        code: "dispatch-or-scope-failure",
        reasons: blockerReasons,
        actions: ["retry", "revise", "rollback", "abandon"],
      },
    }],
  };
  writeCanonicalRun(found.runRoot, completedRun);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: completedAt,
    type: succeeded ? "dispatch-completed" : "dispatch-blocked",
    runId: found.runId,
    checkpointId: task.id,
    attemptId: attempt.id,
    exitCode,
    timedOut,
    scopeStatus: completedAttempt.scope.status,
    usageLabel: usage.label,
  });

  return {
    ok: succeeded,
    run: completedRun,
    runRoot: found.runRoot,
    ownership: owned.ownership,
    nextAction: getNextAction(completedRun),
  };
}

module.exports = {
  executeSupervisedCheckpoint,
  parseManagedUsage,
  writeBoundedLog,
};
