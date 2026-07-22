"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  getGitHeadCommit,
  getGitOutput,
  isRepoDirty,
} = require("../lib/git");
const { normalizeComparePath } = require("../lib/paths");
const {
  findScopeWarnings,
  getWorktreeChangeSummary,
  isWorkerRuntimeOutputPath,
} = require("../lib/scope-check");
const { evaluateControlledOperation } = require("../run/control-gates");
const { assertPolicyAllows } = require("../run/policy");
const { applyThresholdObservation, enforceOperationBudget } = require("./budget");
const {
  runCodexExecAdapter,
  getAdapterExitCode,
  didAdapterTimeOut,
} = require("../run/adapters/codex-exec");
const {
  OWNERSHIP_SCHEMA_VERSION,
  loadOwnershipRecords,
  validateOwnershipRecord,
} = require("../run/ownership");
const {
  appendEvent,
  findSupervisedRun,
  getNextAction,
  writeCanonicalRun,
} = require("./state");
const { captureBaseline } = require("./verification");
const {
  getTestAuthoringVerdict,
  renderTestAuthoringInstruction,
} = require("./test-authoring");

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function writeBoundedLog(filePath, value, maxBytes) {
  const input = Buffer.from(value || "", "utf8");
  const limit = Math.max(0, maxBytes);
  const truncated = input.length > limit;
  const output = truncated ? input.subarray(0, limit) : input;
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

function checkpointBaseCommit(run, task) {
  return task.baseCommit || run.repo.baseCommit;
}

function reuseOwnedWorktree(found, startedAt) {
  const task = found.run.tasks[0];
  const history = Array.isArray(found.run.checkpointHistory) ? found.run.checkpointHistory : [];
  if (history.length === 0) return null;
  const previousCheckpoint = history.at(-1);
  const ownershipPath = path.join(found.runRoot, "ownership.json");
  const previous = validateOwnershipRecord(JSON.parse(fs.readFileSync(ownershipPath, "utf8")));
  if (
    previous.runId !== found.runId
    || previous.checkpointId !== previousCheckpoint.id
    || previous.taskId !== previousCheckpoint.id
    || previous.status !== "released"
  ) {
    throw new Error("Linear continuation requires released ownership from the immediately preceding checkpoint.");
  }
  if (!fs.existsSync(previous.worktree.path) || !fs.statSync(previous.worktree.path).isDirectory()) {
    throw new Error(`Managed continuation worktree is missing: ${previous.worktree.path}`);
  }
  const actualPath = fs.realpathSync.native(previous.worktree.path);
  const expectedRoot = fs.realpathSync.native(path.resolve(
    found.repoRoot,
    "..",
    ".cewp-worktrees",
    path.basename(found.repoRoot),
    found.runId,
  ));
  if (normalizeComparePath(path.dirname(actualPath)) !== normalizeComparePath(expectedRoot)) {
    throw new Error("Managed continuation worktree is outside the expected CEWP run root.");
  }
  const baseCommit = checkpointBaseCommit(found.run, task);
  if (getGitHeadCommit(actualPath) !== baseCommit) {
    throw new Error("Managed continuation worktree no longer matches the verified checkpoint snapshot.");
  }
  const pending = getWorktreeChangeSummary(actualPath, baseCommit).changedFiles
    .filter((file) => !isWorkerRuntimeOutputPath(file));
  if (pending.length > 0) {
    throw new Error(`Managed continuation has unverified changes after the checkpoint snapshot: ${pending.join(", ")}`);
  }

  const ownership = validateOwnershipRecord({
    ...previous,
    taskId: task.id,
    checkpointId: task.id,
    status: "active",
    createdAt: startedAt,
    updatedAt: startedAt,
    releasedAt: undefined,
    worktree: {
      id: `${found.runId}:${task.id}`,
      path: actualPath,
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
    ownershipRecords: [previous],
    requestedOwnership: ownership,
  }, { repoRoot: found.repoRoot });
  if (!gate.allowed) throw new Error(`Controlled continuation blocked: ${gate.reason}`);
  writeJsonAtomic(ownershipPath, ownership);
  return {
    managedRoot: path.dirname(expectedRoot),
    worktreePath: actualPath,
    branch: getGitOutput(["branch", "--show-current"], actualPath).stdout.trim(),
    ownership,
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

  const continued = reuseOwnedWorktree(found, startedAt);
  if (continued) return continued;

  const paths = getWorktreePaths(found);
  const ownershipPath = path.join(found.runRoot, "ownership.json");
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
    ownershipRecords: loadOwnershipRecords(found.repoRoot, { excludePath: ownershipPath }),
    requestedOwnership: ownership,
  }, { repoRoot: found.repoRoot });
  if (!gate.allowed) {
    throw new Error(`Controlled operation blocked: ${gate.reason}`);
  }
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
    checkpointBaseCommit(found.run, found.run.tasks[0]),
  ], found.repoRoot);
  if (created.status !== 0) {
    throw new Error(`Failed to create managed checkpoint worktree: ${(created.stderr || created.stdout || "").trim()}`);
  }

  writeJsonAtomic(ownershipPath, ownership);
  return { ...paths, ownership };
}

function makeWorkerPrompt(run) {
  const task = run.tasks[0];
  return `# CEWP Supervised Checkpoint

Role: worker-a
Task: ${task.id}
Goal: ${run.goal}
Checkpoint objective: ${task.title}

Allowed files:
${task.allowedFiles.map((file) => `- ${file}`).join("\n")}

Forbidden files:
${task.forbiddenFiles.map((file) => `- ${file}`).join("\n")}

Stopping conditions:
${task.stoppingConditions.map((condition) => `- ${condition}`).join("\n")}

${renderTestAuthoringInstruction(run)}

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
  assertPolicyAllows(found.repoRoot, "runWorkers");
  assertPolicyAllows(found.repoRoot, "runCommands");
  enforceOperationBudget(found, "implementation");

  const startedAt = new Date().toISOString();
  const owned = createOwnedWorktree(found, startedAt);
  const baseline = captureBaseline({
    run: found.run,
    runRoot: found.runRoot,
    worktreePath: owned.worktreePath,
    timeoutSeconds: options.timeoutSeconds,
  });
  const outputRoot = path.join(found.runRoot, "adapter-output");
  fs.mkdirSync(outputRoot, { recursive: true });
  const promptPath = path.join(outputRoot, `${task.id}-prompt.md`);
  const stdoutPath = path.join(outputRoot, `${task.id}-stdout.jsonl`);
  const stderrPath = path.join(outputRoot, `${task.id}-stderr.log`);
  const lastMessagePath = path.join(outputRoot, `${task.id}-last-message.md`);
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
    testAuthoring: { policy: found.run.assurance.testAuthoring, status: "pending", violations: [] },
    usage: { label: "unknown", value: null },
  };
  let startedRun = {
    ...found.run,
    status: "executing",
    updatedAt: startedAt,
    budget: JSON.parse(JSON.stringify(found.run.budget)),
    usage: JSON.parse(JSON.stringify(found.run.usage)),
    tasks: [{
      ...task,
      status: "executing",
      verification: {
        ...task.verification,
        runs: [...task.verification.runs, ...baseline.runs],
        latest: baseline.runs.at(-1) || null,
      },
      attempts: [...task.attempts, attempt],
    }],
  };
  startedRun.budget.consumed.modelOperations += 1;
  startedRun.budget.consumed.allocations.implementation += 1;
  startedRun.budget.consumed.targetedVerificationRuns += baseline.runs.length;
  startedRun.budget.consumed.capturedOutputBytes += baseline.capturedBytes;
  startedRun.usage.managedOperations.value += 1;
  const threshold = applyThresholdObservation(startedRun, "implementation", startedAt);
  startedRun = threshold.run;
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
  if (threshold.event) {
    appendEvent(found.runRoot, {
      schemaVersion: "supervised-event/v1-beta",
      timestamp: startedAt,
      type: "budget-threshold",
      runId: found.runId,
      ...threshold.event,
    });
  }
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: startedAt,
    type: "verification-baseline-captured",
    runId: found.runId,
    checkpointId: task.id,
    results: baseline.runs.map((entry) => ({
      id: entry.id,
      status: entry.status,
      failureSignature: entry.failureSignature,
    })),
  });

  const execResult = runCodexExecAdapter({
    worktreePath: owned.worktreePath,
    promptPath,
    outputLastMessagePath: lastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
    sandbox: "workspace-write",
    structuredJson: true,
  });
  const remainingOutput = Math.max(
    0,
    startedRun.budget.maxCapturedOutputBytes.value - startedRun.budget.consumed.capturedOutputBytes,
  );
  const stdoutLog = writeBoundedLog(stdoutPath, execResult.stdout, remainingOutput);
  const stderrLog = writeBoundedLog(
    stderrPath,
    execResult.stderr,
    Math.max(0, remainingOutput - stdoutLog.capturedBytes),
  );
  const exitCode = getAdapterExitCode(execResult);
  const timedOut = didAdapterTimeOut(execResult);
  const usage = parseManagedUsage(execResult.stdout);
  const changes = getWorktreeChangeSummary(
    owned.worktreePath,
    checkpointBaseCommit(found.run, task),
  );
  const scopeWarnings = findScopeWarnings(task.id, changes.changedFiles, task);
  if (changes.committedDiffError) {
    scopeWarnings.push(changes.committedDiffError.message);
  }
  const testAuthoring = getTestAuthoringVerdict(found.run, changes.changedFiles);
  const lastMessagePresent = fs.existsSync(lastMessagePath);
  const succeeded = exitCode === 0
    && !timedOut
    && scopeWarnings.length === 0
    && testAuthoring.status === "pass"
    && lastMessagePresent;
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
    testAuthoring,
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
  blockerReasons.push(...testAuthoring.violations);
  if (!lastMessagePresent) blockerReasons.push("codex-exec last message is missing");
  const completedRun = {
    ...startedRun,
    status: succeeded ? "verifying" : "blocked",
    updatedAt: completedAt,
    usage: {
      ...startedRun.usage,
      managedTokens: mergeManagedUsage(startedRun.usage.managedTokens, usage),
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
  completedRun.budget.consumed.capturedOutputBytes += stdoutLog.capturedBytes + stderrLog.capturedBytes;
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
    testAuthoringStatus: completedAttempt.testAuthoring.status,
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

function mergeManagedUsage(current, observed) {
  if (!observed || observed.label !== "observed") return current;
  if (!current || current.label !== "observed") return observed;
  return {
    ...current,
    observedAt: observed.observedAt,
    observations: current.observations + observed.observations,
    inputTokens: current.inputTokens + observed.inputTokens,
    cachedInputTokens: current.cachedInputTokens + observed.cachedInputTokens,
    outputTokens: current.outputTokens + observed.outputTokens,
    reasoningOutputTokens: current.reasoningOutputTokens + observed.reasoningOutputTokens,
  };
}

function makeRepairPrompt(run) {
  const task = run.tasks[0];
  const latest = task.verification.latest;
  return `# CEWP Supervised Repair

Role: worker-a
Task: ${task.id}
Goal: ${run.goal}
Repair attempt: ${task.attempts.filter((attempt) => attempt.kind === "repair").length + 1}

The approved verification failed.
- Classification: ${latest.classification}
- Failure signature: ${latest.failureSignature}
- Command: ${latest.command}

Allowed files:
${task.allowedFiles.map((file) => `- ${file}`).join("\n")}

${renderTestAuthoringInstruction(run)}

Do one bounded repair inside the existing managed worktree. Do not weaken or delete tests,
expand scope, change the approved budget, merge, push, publish, or finalize.
`;
}

function retrySupervisedCheckpoint(options = {}) {
  if (!options.yes) {
    throw new Error("Supervised retry requires --yes after inspecting the failed verification.");
  }
  const found = findSupervisedRun(options);
  const task = found.run.tasks[0];
  if (found.run.status !== "needs-repair" || task.status !== "repair-ready") {
    throw new Error(`Checkpoint cannot retry from run=${found.run.status}, task=${task.status}.`);
  }
  assertPolicyAllows(found.repoRoot, "runWorkers");
  enforceOperationBudget(found, "repair");
  const repairCount = task.attempts.filter((attempt) => attempt.kind === "repair").length;
  if (repairCount >= found.run.budget.maxRepairsPerCheckpoint.value) {
    throw new Error("Checkpoint repair limit is exhausted; explicit budget revision is required.");
  }

  const ownershipPath = path.join(found.runRoot, "ownership.json");
  const ownership = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
  validateOwnershipRecord(ownership);
  if (
    ownership.runId !== found.runId
    || ownership.taskId !== task.id
    || ownership.checkpointId !== task.id
    || ownership.status !== "active"
    || ownership.owner !== "managed"
    || ownership.backend !== "codex-exec"
  ) {
    throw new Error("Managed codex-exec ownership is not active for repair.");
  }
  if (!fs.existsSync(ownership.worktree.path)) {
    throw new Error(`Managed repair worktree is missing: ${ownership.worktree.path}`);
  }

  const attemptNumber = task.attempts.length + 1;
  const attemptId = `attempt-${attemptNumber}`;
  const startedAt = new Date().toISOString();
  const outputRoot = path.join(found.runRoot, "adapter-output");
  const promptPath = path.join(outputRoot, `${task.id}-${attemptId}-prompt.md`);
  const stdoutPath = path.join(outputRoot, `${task.id}-${attemptId}-stdout.jsonl`);
  const stderrPath = path.join(outputRoot, `${task.id}-${attemptId}-stderr.log`);
  const lastMessagePath = path.join(outputRoot, `${task.id}-${attemptId}-last-message.md`);
  fs.writeFileSync(promptPath, makeRepairPrompt(found.run));
  const attempt = {
    id: attemptId,
    kind: "repair",
    status: "running",
    startedAt,
    completedAt: null,
    exitCode: null,
    timedOut: false,
    changedFiles: [],
    scope: { status: "pending", warnings: [] },
    testAuthoring: { policy: found.run.assurance.testAuthoring, status: "pending", violations: [] },
    usage: { label: "unknown", value: null },
  };
  let startedRun = {
    ...found.run,
    status: "executing",
    updatedAt: startedAt,
    budget: JSON.parse(JSON.stringify(found.run.budget)),
    usage: JSON.parse(JSON.stringify(found.run.usage)),
    tasks: [{
      ...task,
      status: "executing",
      attempts: [...task.attempts, attempt],
      blocker: null,
    }],
  };
  startedRun.budget.consumed.modelOperations += 1;
  startedRun.budget.consumed.allocations.repair += 1;
  startedRun.usage.managedOperations.value += 1;
  const threshold = applyThresholdObservation(startedRun, "repair", startedAt);
  startedRun = threshold.run;
  writeCanonicalRun(found.runRoot, startedRun);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: startedAt,
    type: "repair-started",
    runId: found.runId,
    checkpointId: task.id,
    attemptId,
    allocation: "repair",
  });
  if (threshold.event) {
    appendEvent(found.runRoot, {
      schemaVersion: "supervised-event/v1-beta",
      timestamp: startedAt,
      type: "budget-threshold",
      runId: found.runId,
      ...threshold.event,
    });
  }

  const execResult = runCodexExecAdapter({
    worktreePath: ownership.worktree.path,
    promptPath,
    outputLastMessagePath: lastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
    sandbox: "workspace-write",
    structuredJson: true,
  });
  const remainingOutput = Math.max(
    0,
    startedRun.budget.maxCapturedOutputBytes.value - startedRun.budget.consumed.capturedOutputBytes,
  );
  const stdoutLog = writeBoundedLog(stdoutPath, execResult.stdout, remainingOutput);
  const stderrLog = writeBoundedLog(
    stderrPath,
    execResult.stderr,
    Math.max(0, remainingOutput - stdoutLog.capturedBytes),
  );
  const exitCode = getAdapterExitCode(execResult);
  const timedOut = didAdapterTimeOut(execResult);
  const usage = parseManagedUsage(execResult.stdout);
  const changes = getWorktreeChangeSummary(
    ownership.worktree.path,
    checkpointBaseCommit(found.run, task),
  );
  const scopeWarnings = findScopeWarnings(task.id, changes.changedFiles, task);
  if (changes.committedDiffError) scopeWarnings.push(changes.committedDiffError.message);
  const testAuthoring = getTestAuthoringVerdict(found.run, changes.changedFiles);
  const lastMessagePresent = fs.existsSync(lastMessagePath);
  const succeeded = exitCode === 0
    && !timedOut
    && scopeWarnings.length === 0
    && testAuthoring.status === "pass"
    && lastMessagePresent;
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
    testAuthoring,
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
  const run = {
    ...startedRun,
    status: succeeded ? "verifying" : "blocked",
    updatedAt: completedAt,
    usage: {
      ...startedRun.usage,
      managedTokens: mergeManagedUsage(startedRun.usage.managedTokens, usage),
    },
    tasks: [{
      ...startedRun.tasks[0],
      status: succeeded ? "awaiting-verification" : "blocked",
      attempts: [...startedRun.tasks[0].attempts.slice(0, -1), completedAttempt],
      blocker: succeeded ? null : {
        code: "repair-dispatch-failure",
        reasons: [
          ...(exitCode === 0 ? [] : [`codex-exec exited with code ${exitCode}`]),
          ...(timedOut ? [`codex-exec timed out after ${options.timeoutSeconds}s`] : []),
          ...scopeWarnings,
          ...testAuthoring.violations,
          ...(lastMessagePresent ? [] : ["codex-exec last message is missing"]),
        ],
        actions: ["revise", "rollback", "abandon"],
      },
    }],
  };
  run.budget.consumed.capturedOutputBytes += stdoutLog.capturedBytes + stderrLog.capturedBytes;
  writeCanonicalRun(found.runRoot, run);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: completedAt,
    type: succeeded ? "repair-completed" : "repair-blocked",
    runId: found.runId,
    checkpointId: task.id,
    attemptId,
    exitCode,
    timedOut,
    scopeStatus: completedAttempt.scope.status,
    testAuthoringStatus: completedAttempt.testAuthoring.status,
    usageLabel: usage.label,
  });
  return {
    ok: succeeded,
    run,
    runRoot: found.runRoot,
    ownership,
    nextAction: getNextAction(run),
  };
}

module.exports = {
  executeSupervisedCheckpoint,
  mergeManagedUsage,
  retrySupervisedCheckpoint,
  parseManagedUsage,
  writeBoundedLog,
};
