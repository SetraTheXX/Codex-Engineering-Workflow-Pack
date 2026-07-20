"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ensureDir } = require("../lib/fs");
const { normalizeSlashPath } = require("../lib/paths");
const { digestWorkflowDefinition, validateWorkflowDefinition } = require("./definition");
const { readRepoJson } = require("./source");
const { deriveSchedule } = require("./scheduler");
const { evaluateWorkflowOperation } = require("./budget");
const { deriveProgressView, renderProgressMarkdown } = require("./progress");
const { digestWorkflowApproval } = require("./proposal");
const { validateReviewResult } = require("./review");
const { previewWorkflowRevision } = require("./revision");
const { validateTaskResult } = require("./result");
const {
  CHECKPOINT_TRANSITIONS,
  REVISION_REQUIRED_FAILURES,
  TASK_TRANSITIONS,
  WAIVABLE_FAILURES,
  assertWaivableClassification,
  transitionCheckpoint,
  transitionRun,
  transitionTask,
  validateFailureClassification,
} = require("./transitions");

const RUN_STATE_SCHEMA_VERSION = "run-state/v2";

function timestampId(date) {
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3),
  ].join("");
}

function allocateRunId(repoRoot, workflowId, now) {
  const runsRoot = path.join(repoRoot, ".cewp", "workflow-runs");
  const base = `${workflowId}-${timestampId(now)}`;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const runId = attempt === 0 ? base : `${base}-${attempt}`;
    if (!fs.existsSync(path.join(runsRoot, runId))) return runId;
  }
  throw new Error("Could not allocate a unique workflow run id.");
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function writeTextAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value, { flag: "wx" });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function writeWorkflowProgress(runRoot, run, definition, options = {}) {
  const schedule = deriveSchedule(run, definition);
  const progress = deriveProgressView(run, definition, schedule, options);
  writeJsonAtomic(path.join(runRoot, "progress.json"), progress);
  writeTextAtomic(path.join(runRoot, "progress.md"), renderProgressMarkdown(progress));
  return progress;
}

function persistApprovedDefinition(repoRoot, definition, digest) {
  const definitionsRoot = path.join(
    repoRoot,
    ".cewp",
    "workflows",
    definition.workflowId,
    "definitions",
  );
  const definitionPath = path.join(
    definitionsRoot,
    `revision-${String(definition.revision.number).padStart(6, "0")}.json`,
  );
  if (fs.existsSync(definitionPath)) {
    const existing = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
    if (digestWorkflowDefinition(existing) !== digest) {
      throw new Error(`Workflow revision ${definition.revision.number} already exists with different content.`);
    }
  } else {
    writeJsonAtomic(definitionPath, definition);
  }
  return definitionPath;
}

function runtimeBudgetForRevision(previous, definition) {
  return {
    ...definition.budget,
    consumed: previous.consumed,
    thresholdEvents: previous.thresholdEvents,
    revisions: [...previous.revisions, {
      revision: previous.revisions.length + 1,
      event: "workflow-revision",
      previousModelOperations: previous.modelOperations,
      nextModelOperations: definition.budget.modelOperations,
    }],
    hostLimit: previous.hostLimit,
    pauseReason: previous.pauseReason,
    resumeStatus: previous.resumeStatus,
  };
}

function initialRuntimeTask(task) {
  return {
    id: task.id,
    status: "pending",
    attempts: 0,
    activeCheckpointId: null,
    resultId: null,
    verification: null,
    blocker: null,
    failureHistory: [],
    assignedWorker: null,
    stateHistory: [],
  };
}

function applyWorkflowRevision(found, candidate, options = {}) {
  const now = options.now || new Date();
  const timestamp = now.toISOString();
  const preview = previewWorkflowRevision(found.run, found.definition, candidate);
  if (options.expectedDigest !== preview.digest) {
    throw new Error("Workflow revision changed after preview. Run `cewp workflow revise` again and approve its digest.");
  }
  const revision = preview.definition.revision.number;
  const backupPath = path.join(
    found.runRoot,
    "backups",
    `run-before-revision-${String(revision).padStart(6, "0")}.json`,
  );
  if (fs.existsSync(backupPath)) throw new Error(`Workflow revision ${revision} already has a run backup.`);
  const definitionPath = persistApprovedDefinition(found.repoRoot, preview.definition, preview.digest);
  writeJsonAtomic(backupPath, found.run);
  const previousById = new Map(found.run.tasks.map((task) => [task.id, task]));
  let tasks = preview.definition.tasks.map((definitionTask) => {
    const previous = previousById.get(definitionTask.id);
    if (previous && previous.status === "completed") return previous;
    const next = initialRuntimeTask(definitionTask);
    if (!previous) return next;
    return {
      ...next,
      attempts: previous.attempts,
      failureHistory: previous.failureHistory || [],
      assignedWorker: previous.assignedWorker || null,
      stateHistory: [...(previous.stateHistory || []), {
        workflowRevision: found.run.workflow.revision,
        status: previous.status,
        attempts: previous.attempts,
        resultId: previous.resultId,
        verification: previous.verification,
        blocker: previous.blocker,
        archivedAt: timestamp,
      }],
    };
  });
  const completedIds = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id));
  tasks = tasks.map((task) => {
    if (task.status === "completed") return task;
    const definitionTask = preview.definition.tasks.find((entry) => entry.id === task.id);
    return {
      ...task,
      status: definitionTask.dependsOn.every((dependencyId) => completedIds.has(dependencyId)) ? "ready" : "pending",
    };
  });
  const allComplete = tasks.every((task) => task.status === "completed");
  const pauseStatuses = new Set(["paused-budget-safe", "paused-budget-unverified", "paused-host-limit"]);
  const status = pauseStatuses.has(found.run.status)
    ? found.run.status
    : allComplete
      ? preview.definition.reviewerPolicy.requiredForFinalize ? "review-pending" : "completed"
      : found.run.status === "approved" ? "approved" : "active";
  const previousReviewer = found.run.reviewer;
  const reviewHistory = [...(found.run.reviewHistory || [])];
  if (previousReviewer && (previousReviewer.decision || previousReviewer.reviewId)) {
    reviewHistory.push({ ...previousReviewer, archivedAt: timestamp });
  }
  const run = {
    ...found.run,
    workflow: {
      id: preview.definition.workflowId,
      revision,
      digest: preview.digest,
      definitionPath: normalizeSlashPath(path.relative(found.repoRoot, definitionPath)),
    },
    status,
    updatedAt: timestamp,
    goal: preview.definition.goal,
    execution: preview.definition.execution,
    assurance: preview.definition.assurance,
    checkpointPolicy: preview.definition.checkpointPolicy,
    reviewerPolicy: preview.definition.reviewerPolicy,
    tasks,
    budget: runtimeBudgetForRevision(found.run.budget, preview.definition),
    approval: {
      actor: "operator",
      approvedAt: timestamp,
      digest: preview.digest,
      source: options.source,
      previousDigest: found.run.workflow.digest,
    },
    reviewer: {
      status: preview.definition.reviewerPolicy.requiredForFinalize ? "pending" : "not-required",
      decision: null,
    },
    reviewHistory,
    revisionHistory: [...(found.run.revisionHistory || []), {
      revision: found.run.workflow.revision,
      digest: found.run.workflow.digest,
      definitionPath: found.run.workflow.definitionPath,
      backupPath: normalizeSlashPath(path.relative(found.repoRoot, backupPath)),
      supersededAt: timestamp,
      reason: preview.definition.revision.reason,
    }],
  };
  writeJsonAtomic(found.runPath, run);
  const progress = writeWorkflowProgress(found.runRoot, run, preview.definition, { now });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "workflow-revised",
    runId: run.runId,
    previousRevision: found.run.workflow.revision,
    revision,
    previousDigest: found.run.workflow.digest,
    digest: preview.digest,
    reason: preview.definition.revision.reason,
    backupPath: normalizeSlashPath(path.relative(found.repoRoot, backupPath)),
    actor: "operator",
  });
  return {
    run,
    definition: preview.definition,
    diff: preview.diff,
    backupPath: normalizeSlashPath(path.relative(found.repoRoot, backupPath)),
    progress,
    ...deriveSchedule(run, preview.definition),
  };
}

function makeRuntimeBudget(budget) {
  return {
    ...budget,
    consumed: {
      modelOperations: 0,
      allocations: Object.fromEntries(Object.keys(budget.allocations).map((name) => [name, 0])),
      targetedVerificationRuns: 0,
      fullVerificationRuns: 0,
      capturedOutputBytes: 0,
    },
    thresholdEvents: [],
    revisions: [],
    hostLimit: null,
    pauseReason: null,
    resumeStatus: null,
  };
}

function validateWorkflowRunId(runId) {
  if (typeof runId !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(runId)) {
    throw new Error(`Invalid workflow run id: ${runId || "missing"}.`);
  }
  return runId;
}

function loadWorkflowRun(repoRoot, runId) {
  const resolvedRoot = path.resolve(repoRoot);
  validateWorkflowRunId(runId);
  const runPath = path.join(resolvedRoot, ".cewp", "workflow-runs", runId, "run.json");
  if (!fs.existsSync(runPath)) throw new Error(`Workflow run not found: ${runId}.`);
  const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
  if (run.schemaVersion !== RUN_STATE_SCHEMA_VERSION || run.runId !== runId) {
    throw new Error(`Invalid workflow run state: ${runId}.`);
  }
  const definitionFile = readRepoJson(resolvedRoot, run.workflow && run.workflow.definitionPath, "approved workflow definition");
  const definition = validateWorkflowDefinition(definitionFile.value);
  const digest = digestWorkflowDefinition(definition);
  if (
    run.workflow.id !== definition.workflowId
    || run.workflow.revision !== definition.revision.number
    || run.workflow.digest !== digest
  ) {
    throw new Error(`Workflow run ${runId} does not match its approved definition digest.`);
  }
  return {
    repoRoot: resolvedRoot,
    runRoot: path.dirname(runPath),
    runPath,
    run,
    definition,
  };
}

function appendWorkflowEvent(runRoot, event) {
  fs.appendFileSync(path.join(runRoot, "events.jsonl"), `${JSON.stringify(event)}\n`);
}

function pauseForWorkflowBudget(found, allocation, decision, timestamp) {
  const pauseEvent = decision.pauseStatus === "paused-host-limit"
    ? "pause-host-limit"
    : decision.pauseStatus === "paused-budget-unverified"
      ? "pause-budget-unverified"
      : "pause-budget-safe";
  const run = {
    ...found.run,
    status: transitionRun(found.run.status, pauseEvent),
    updatedAt: timestamp,
    budget: {
      ...found.run.budget,
      pauseReason: decision.reason,
      resumeStatus: found.run.status,
      thresholdEvents: [...found.run.budget.thresholdEvents, {
        threshold: decision.warning,
        percent: decision.percent,
        allocation,
        observedAt: timestamp,
      }],
    },
    warnings: [...(found.run.warnings || []), `Workflow operation paused: ${decision.reason}.`],
  };
  writeJsonAtomic(found.runPath, run);
  writeWorkflowProgress(found.runRoot, run, found.definition, { now: new Date(timestamp) });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: decision.pauseStatus,
    runId: run.runId,
    reason: decision.reason,
    allocation,
  });
  return run;
}

function refuseWorkflowResultBudget(found, allocation, reason, warning, message, timestamp) {
  pauseForWorkflowBudget(found, allocation, {
    allowed: false,
    reason,
    pauseStatus: "paused-budget-unverified",
    warning,
    percent: null,
    protectedAllocation: found.run.budget.protectedAllocations.includes(allocation),
  }, timestamp);
  throw new Error(message);
}

function refuseWorkflowReviewBudget(found, reason, warning, message, timestamp) {
  pauseForWorkflowBudget(found, "reviewer", {
    allowed: false,
    reason,
    pauseStatus: "paused-budget-safe",
    warning,
    percent: null,
    protectedAllocation: true,
  }, timestamp);
  throw new Error(message);
}

function startWorkflowTask(found, taskId, options = {}) {
  const now = options.now || new Date();
  const timestamp = now.toISOString();
  const definitionTask = found.definition.tasks.find((task) => task.id === taskId);
  const runtimeTask = found.run.tasks.find((task) => task.id === taskId);
  if (!definitionTask || !runtimeTask) throw new Error(`Unknown workflow task: ${taskId}.`);
  if (!["approved", "active"].includes(found.run.status)) {
    throw new Error(`Workflow run ${found.run.runId} cannot start work from status ${found.run.status}.`);
  }
  const schedule = deriveSchedule(found.run, found.definition);
  if (runtimeTask.status !== "ready") {
    throw new Error(`Workflow task ${taskId} is not ready; current status is ${runtimeTask.status}.`);
  }
  if (!schedule.readyTasks.some((task) => task.id === taskId)) {
    if (schedule.queuedReadyTasks.some((task) => task.id === taskId)) {
      throw new Error(`Workflow task ${taskId} is ready but no worker capacity is available.`);
    }
    throw new Error(`Workflow task ${taskId} is not ready because a dependency is incomplete.`);
  }
  if (runtimeTask.assignedWorker && options.workerId && runtimeTask.assignedWorker !== options.workerId) {
    throw new Error(`Workflow task ${taskId} is assigned to ${runtimeTask.assignedWorker}; use an explicit reassign intervention.`);
  }
  const workerId = runtimeTask.assignedWorker || options.workerId || null;
  const allocation = runtimeTask.attempts === 0 ? "implementation" : "repair";
  if (allocation === "repair" && runtimeTask.attempts > found.run.budget.maxRepairsPerCheckpoint) {
    throw new Error(`Workflow task ${taskId} exhausted its repair-attempt budget.`);
  }
  const budgetDecision = evaluateWorkflowOperation(found.run, allocation, { now });
  if (!budgetDecision.allowed) {
    pauseForWorkflowBudget(found, allocation, budgetDecision, timestamp);
    throw new Error(`Controlled workflow operation paused: ${budgetDecision.pauseStatus} (${budgetDecision.reason}).`);
  }
  let runBeforeStart = found.run;
  if (
    budgetDecision.warning
    && !found.run.budget.thresholdEvents.some((event) => event.threshold === budgetDecision.warning)
  ) {
    runBeforeStart = {
      ...found.run,
      budget: {
        ...found.run.budget,
        thresholdEvents: [...found.run.budget.thresholdEvents, {
          threshold: budgetDecision.warning,
          percent: budgetDecision.percent,
          allocation,
          observedAt: timestamp,
        }],
      },
      warnings: [...(found.run.warnings || []), `Workflow budget warning: ${budgetDecision.warning}.`],
    };
  }
  const attempt = runtimeTask.attempts + 1;
  const checkpointId = `${taskId}-attempt-${String(attempt).padStart(4, "0")}`;
  const checkpoint = {
    schemaVersion: "task-checkpoint/v1",
    checkpointId,
    runId: found.runId || found.run.runId,
    taskId,
    attempt,
    status: "running",
    startedAt: timestamp,
    completedAt: null,
    assurance: runBeforeStart.assurance,
    scope: {
      allowedFiles: definitionTask.allowedFiles,
      forbiddenFiles: definitionTask.forbiddenFiles,
    },
    stoppingConditions: definitionTask.stoppingConditions,
    verification: {
      schedule: definitionTask.verification,
      baseline: { status: "pending", evidence: [] },
      latest: null,
    },
    budget: {
      activeAllocation: allocation,
      implementationAllocation: runBeforeStart.budget.allocations.implementation,
      repairAllocation: runBeforeStart.budget.allocations.repair,
      maxRepairs: runBeforeStart.budget.maxRepairsPerCheckpoint,
      maxCapturedOutputBytes: runBeforeStart.budget.maxCapturedOutputBytes,
    },
    result: null,
    failureClassification: null,
    interventionState: null,
    reviewer: {
      required: runBeforeStart.checkpointPolicy.reviewerAfterEachTask,
      status: runBeforeStart.checkpointPolicy.reviewerAfterEachTask ? "pending" : "not-required",
    },
    worker: {
      id: workerId,
      source: runtimeTask.assignedWorker ? "intervention" : options.workerId ? "start" : "scheduler",
    },
  };
  const checkpointPath = path.join(
    found.runRoot,
    "checkpoints",
    taskId,
    `attempt-${String(attempt).padStart(4, "0")}.json`,
  );
  writeJsonAtomic(checkpointPath, checkpoint);
  const run = {
    ...runBeforeStart,
    status: transitionRun(runBeforeStart.status, "task-started"),
    updatedAt: timestamp,
    tasks: runBeforeStart.tasks.map((task) => (task.id === taskId ? {
      ...task,
      status: transitionTask(task.status, "start"),
      attempts: attempt,
      activeCheckpointId: checkpointId,
      assignedWorker: workerId,
    } : task)),
  };
  writeJsonAtomic(found.runPath, run);
  const progress = writeWorkflowProgress(found.runRoot, run, found.definition, { now });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "task-started",
    runId: run.runId,
    taskId,
    checkpointId,
    actor: "operator",
  });
  return {
    run,
    checkpoint,
    checkpointPath: normalizeSlashPath(path.relative(found.repoRoot, checkpointPath)),
    progress,
    ...deriveSchedule(run, found.definition),
  };
}

function recordWorkflowResult(found, taskId, candidate) {
  const runtimeTask = found.run.tasks.find((task) => task.id === taskId);
  const definitionTask = found.definition.tasks.find((task) => task.id === taskId);
  if (!runtimeTask || !definitionTask) throw new Error(`Unknown workflow task: ${taskId}.`);
  if (runtimeTask.status !== "running" || !runtimeTask.activeCheckpointId) {
    throw new Error(`Workflow task ${taskId} cannot accept a result from status ${runtimeTask.status}.`);
  }
  const checkpointPath = path.join(
    found.runRoot,
    "checkpoints",
    taskId,
    `attempt-${String(runtimeTask.attempts).padStart(4, "0")}.json`,
  );
  if (!fs.existsSync(checkpointPath)) throw new Error(`Active checkpoint file is missing for task ${taskId}.`);
  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  if (
    checkpoint.schemaVersion !== "task-checkpoint/v1"
    || checkpoint.checkpointId !== runtimeTask.activeCheckpointId
    || checkpoint.status !== "running"
  ) {
    throw new Error(`Invalid active checkpoint for task ${taskId}.`);
  }
  const result = validateTaskResult(candidate, {
    run: found.run,
    task: runtimeTask,
    checkpoint,
    definitionTask,
  });
  const observedOperations = result.usage.managedOperations.value;
  const activeAllocation = checkpoint.budget.activeAllocation || "implementation";
  const consumedOperations = found.run.budget.consumed.modelOperations + observedOperations;
  const consumedAllocation = found.run.budget.consumed.allocations[activeAllocation] + observedOperations;
  const consumedTargetedRuns = found.run.budget.consumed.targetedVerificationRuns
    + result.verification.baseline.evidence.length
    + result.verification.targeted.length;
  const consumedFullRuns = found.run.budget.consumed.fullVerificationRuns
    + result.verification.full.length;
  const consumedOutputBytes = found.run.budget.consumed.capturedOutputBytes
    + result.usage.capturedOutputBytes.value;
  if (consumedOperations > found.run.budget.modelOperations) {
    refuseWorkflowResultBudget(
      found,
      activeAllocation,
      "absolute-ceiling-exhausted",
      "budget-absolute-ceiling",
      "Task result would exceed the workflow absolute model-operation ceiling.",
      result.completedAt,
    );
  }
  if (consumedAllocation > found.run.budget.allocations[activeAllocation]) {
    refuseWorkflowResultBudget(
      found,
      activeAllocation,
      `${activeAllocation}-allocation-exhausted`,
      "budget-allocation-exhausted",
      `Task result would exceed the workflow ${activeAllocation} allocation.`,
      result.completedAt,
    );
  }
  if (consumedTargetedRuns > found.run.budget.maxTargetedVerificationRuns) {
    refuseWorkflowResultBudget(
      found,
      activeAllocation,
      "targeted-verification-budget-exhausted",
      "budget-targeted-verification-ceiling",
      "Task result would exceed the workflow targeted verification-run ceiling.",
      result.completedAt,
    );
  }
  if (consumedFullRuns > found.run.budget.maxFullVerificationRuns) {
    refuseWorkflowResultBudget(
      found,
      activeAllocation,
      "full-verification-budget-exhausted",
      "budget-full-verification-ceiling",
      "Task result would exceed the workflow full verification-run ceiling.",
      result.completedAt,
    );
  }
  if (consumedOutputBytes > found.run.budget.maxCapturedOutputBytes) {
    refuseWorkflowResultBudget(
      found,
      activeAllocation,
      "captured-output-budget-exhausted",
      "budget-captured-output-ceiling",
      "Task result would exceed the workflow captured-output ceiling.",
      result.completedAt,
    );
  }
  const resultPath = path.join(
    found.runRoot,
    "results",
    taskId,
    `attempt-${String(runtimeTask.attempts).padStart(4, "0")}.json`,
  );
  writeJsonAtomic(resultPath, result);
  const resultRecordedCheckpointStatus = transitionCheckpoint(checkpoint.status, "result-recorded");
  const completedCheckpoint = {
    ...checkpoint,
    status: transitionCheckpoint(resultRecordedCheckpointStatus, "verification-passed"),
    completedAt: result.completedAt,
    result: {
      resultId: result.resultId,
      path: normalizeSlashPath(path.relative(found.repoRoot, resultPath)),
    },
    verification: {
      ...checkpoint.verification,
      baseline: result.verification.baseline,
      latest: {
        status: "passed",
        targeted: result.verification.targeted,
        full: result.verification.full,
      },
    },
  };
  writeJsonAtomic(checkpointPath, completedCheckpoint);
  const verifyingTaskStatus = transitionTask(runtimeTask.status, "result-recorded");
  let tasks = found.run.tasks.map((task) => (task.id === taskId ? {
    ...task,
    status: transitionTask(verifyingTaskStatus, "verification-passed"),
    activeCheckpointId: null,
    resultId: result.resultId,
    verification: {
      status: "passed",
      checkpointId: checkpoint.checkpointId,
      resultId: result.resultId,
    },
  } : task));
  const runtimeById = new Map(tasks.map((task) => [task.id, task]));
  tasks = tasks.map((task) => {
    if (task.status !== "pending") return task;
    const taskDefinition = found.definition.tasks.find((entry) => entry.id === task.id);
    return taskDefinition.dependsOn.every((dependencyId) => runtimeById.get(dependencyId).status === "completed")
      ? { ...task, status: "ready" }
      : task;
  });
  const allComplete = tasks.every((task) => task.status === "completed");
  const hasBlockedTask = tasks.some((task) => task.status === "blocked");
  let runStatus = found.run.status;
  if (allComplete) {
    runStatus = transitionRun(
      found.run.status,
      found.run.reviewerPolicy.requiredForFinalize ? "tasks-completed" : "tasks-completed-no-review",
    );
  } else if (!hasBlockedTask) {
    runStatus = "active";
  }
  const run = {
    ...found.run,
    status: runStatus,
    updatedAt: result.completedAt,
    tasks,
    budget: {
      ...found.run.budget,
      consumed: {
        ...found.run.budget.consumed,
        modelOperations: consumedOperations,
        targetedVerificationRuns: consumedTargetedRuns,
        fullVerificationRuns: consumedFullRuns,
        capturedOutputBytes: consumedOutputBytes,
        allocations: {
          ...found.run.budget.consumed.allocations,
          [activeAllocation]: consumedAllocation,
        },
      },
    },
  };
  writeJsonAtomic(found.runPath, run);
  const progress = writeWorkflowProgress(found.runRoot, run, found.definition, { now: new Date(result.completedAt) });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp: result.completedAt,
    type: "task-completed",
    runId: run.runId,
    taskId,
    checkpointId: checkpoint.checkpointId,
    resultId: result.resultId,
  });
  return {
    run,
    checkpoint: completedCheckpoint,
    result,
    resultPath: normalizeSlashPath(path.relative(found.repoRoot, resultPath)),
    progress,
    ...deriveSchedule(run, found.definition),
  };
}

function recordWorkflowReview(found, candidate) {
  if (found.run.status !== "review-pending") {
    throw new Error(`Workflow review requires review-pending; current status is ${found.run.status}.`);
  }
  if (!found.run.reviewerPolicy.requiredForFinalize) {
    throw new Error("Workflow definition does not require an independent final reviewer.");
  }
  const review = validateReviewResult(candidate, { run: found.run, definition: found.definition });
  const now = new Date(review.completedAt);
  const budgetDecision = evaluateWorkflowOperation(found.run, "reviewer", { now });
  if (!budgetDecision.allowed) {
    pauseForWorkflowBudget(found, "reviewer", budgetDecision, review.completedAt);
    throw new Error(`Controlled workflow review paused: ${budgetDecision.pauseStatus} (${budgetDecision.reason}).`);
  }
  const observedOperations = review.usage.managedOperations.value;
  const consumedOperations = found.run.budget.consumed.modelOperations + observedOperations;
  const consumedReviewer = found.run.budget.consumed.allocations.reviewer + observedOperations;
  const consumedOutputBytes = found.run.budget.consumed.capturedOutputBytes
    + review.usage.capturedOutputBytes.value;
  if (consumedOperations > found.run.budget.modelOperations) {
    refuseWorkflowReviewBudget(
      found,
      "absolute-ceiling-exhausted",
      "budget-absolute-ceiling",
      "Review result would exceed the workflow absolute model-operation ceiling.",
      review.completedAt,
    );
  }
  if (consumedReviewer > found.run.budget.allocations.reviewer) {
    refuseWorkflowReviewBudget(
      found,
      "reviewer-allocation-exhausted",
      "budget-allocation-exhausted",
      "Review result would exceed the workflow reviewer allocation.",
      review.completedAt,
    );
  }
  if (consumedOutputBytes > found.run.budget.maxCapturedOutputBytes) {
    refuseWorkflowReviewBudget(
      found,
      "captured-output-budget-exhausted",
      "budget-captured-output-ceiling",
      "Review result would exceed the workflow captured-output ceiling.",
      review.completedAt,
    );
  }
  const reviewPath = path.join(found.runRoot, "reviews", `${review.reviewId}.json`);
  writeJsonAtomic(reviewPath, review);
  const passed = review.decision === "PASS";
  const affectedTaskIds = new Set(review.findings.map((finding) => finding.taskId).filter(Boolean));
  const tasks = passed ? found.run.tasks : found.run.tasks.map((task) => {
    if (!affectedTaskIds.has(task.id)) return task;
    const finding = review.findings.find((entry) => entry.taskId === task.id);
    return {
      ...task,
      status: transitionTask(task.status, "reviewer-block"),
      blocker: {
        classification: finding.classification,
        reason: finding.summary,
        blockedAt: review.completedAt,
        waivable: WAIVABLE_FAILURES.has(finding.classification),
        source: "independent-review",
        reviewId: review.reviewId,
      },
    };
  });
  const run = {
    ...found.run,
    status: transitionRun(found.run.status, passed ? "reviewer-pass" : "reviewer-block"),
    updatedAt: review.completedAt,
    tasks,
    budget: {
      ...found.run.budget,
      consumed: {
        ...found.run.budget.consumed,
        modelOperations: consumedOperations,
        capturedOutputBytes: consumedOutputBytes,
        allocations: {
          ...found.run.budget.consumed.allocations,
          reviewer: consumedReviewer,
        },
      },
    },
    reviewer: {
      status: passed
        ? "passed"
        : review.decision === "REQUEST_CHANGES" ? "changes-requested" : "blocked",
      decision: review.decision,
      independent: true,
      reviewId: review.reviewId,
      reviewPath: normalizeSlashPath(path.relative(found.repoRoot, reviewPath)),
      completedAt: review.completedAt,
      findings: review.findings.length,
    },
    reviewHistory: found.run.reviewer && (found.run.reviewer.decision || found.run.reviewer.reviewId)
      ? [...(found.run.reviewHistory || []), { ...found.run.reviewer, archivedAt: review.completedAt }]
      : [...(found.run.reviewHistory || [])],
    warnings: passed
      ? found.run.warnings
      : [...(found.run.warnings || []), `Independent reviewer decision: ${review.decision}.`],
  };
  writeJsonAtomic(found.runPath, run);
  const progress = writeWorkflowProgress(found.runRoot, run, found.definition, { now });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp: review.completedAt,
    type: passed ? "review-passed" : "review-blocked",
    runId: run.runId,
    reviewId: review.reviewId,
    decision: review.decision,
    affectedTaskIds: [...affectedTaskIds].sort(),
  });
  return {
    ok: passed,
    run,
    review,
    reviewPath: normalizeSlashPath(path.relative(found.repoRoot, reviewPath)),
    progress,
    ...deriveSchedule(run, found.definition),
  };
}

function finalizeWorkflowRun(found, options = {}) {
  const now = options.now || new Date();
  const timestamp = now.toISOString();
  if (!found.run.tasks.every((task) => task.status === "completed" && task.resultId && task.verification && task.verification.status === "passed")) {
    throw new Error("Workflow finalization requires every task to retain a verified result.");
  }
  if (found.run.reviewerPolicy.requiredForFinalize && found.run.reviewer.status !== "passed") {
    throw new Error(`Workflow finalization requires reviewer PASS; current status is ${found.run.status}.`);
  }
  const run = {
    ...found.run,
    status: transitionRun(found.run.status, "finalize"),
    updatedAt: timestamp,
    finalization: {
      actor: "operator",
      finalizedAt: timestamp,
      reviewerDecision: found.run.reviewer.decision,
    },
  };
  writeJsonAtomic(found.runPath, run);
  const progress = writeWorkflowProgress(found.runRoot, run, found.definition, { now });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "workflow-finalized",
    runId: run.runId,
    actor: "operator",
    reviewerDecision: run.reviewer.decision,
  });
  return { run, progress, ...deriveSchedule(run, found.definition) };
}

function getActiveCheckpoint(found, runtimeTask) {
  if (!runtimeTask.activeCheckpointId) return { checkpoint: null, checkpointPath: null };
  const checkpointPath = path.join(
    found.runRoot,
    "checkpoints",
    runtimeTask.id,
    `attempt-${String(runtimeTask.attempts).padStart(4, "0")}.json`,
  );
  if (!fs.existsSync(checkpointPath)) throw new Error(`Active checkpoint file is missing for task ${runtimeTask.id}.`);
  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  if (checkpoint.checkpointId !== runtimeTask.activeCheckpointId) {
    throw new Error(`Active checkpoint identity mismatch for task ${runtimeTask.id}.`);
  }
  return { checkpoint, checkpointPath };
}

const RUN_INTERVENTION_EVENTS = new Set([
  "add-budget",
  "pause-budget-safe",
  "pause-budget-unverified",
  "pause-host-limit",
  "resume",
]);
const RUN_LIFECYCLE_EVENTS = new Set(["continue", "cancel", "timeout", "rollback", "abandon"]);
const RESUMABLE_RUN_STATUSES = new Set(["approved", "active", "review-pending"]);

function workflowResumeStatus(budget, fallback) {
  if (budget.resumeStatus === null || budget.resumeStatus === undefined) return fallback;
  if (!RESUMABLE_RUN_STATUSES.has(budget.resumeStatus)) {
    throw new Error(`Invalid workflow resume status: ${budget.resumeStatus}.`);
  }
  return budget.resumeStatus;
}

function interveneWorkflowRun(found, options, timestamp, reason) {
  let budget = found.run.budget;
  const previousStatus = found.run.status;
  let nextStatus = transitionRun(previousStatus, options.event);
  if (options.event === "add-budget") {
    if (!Number.isInteger(options.operations) || options.operations < 1) {
      throw new Error("add-budget requires --operations with a positive integer.");
    }
    if (!options.allocation || !Object.hasOwn(budget.allocations, options.allocation)) {
      throw new Error("add-budget requires one approved model-operation --allocation.");
    }
    const previousModelOperations = budget.modelOperations;
    nextStatus = workflowResumeStatus(budget, nextStatus);
    budget = {
      ...budget,
      modelOperations: previousModelOperations + options.operations,
      allocations: {
        ...budget.allocations,
        [options.allocation]: budget.allocations[options.allocation] + options.operations,
      },
      pauseReason: null,
      resumeStatus: null,
      revisions: [...budget.revisions, {
        revision: budget.revisions.length + 1,
        event: "add-budget",
        allocation: options.allocation,
        operations: options.operations,
        previousModelOperations,
        nextModelOperations: previousModelOperations + options.operations,
        reason,
        actor: "operator",
        approvedAt: timestamp,
      }],
    };
  } else if (options.event === "pause-host-limit") {
    budget = {
      ...budget,
      hostLimit: {
        active: true,
        observedAt: timestamp,
        source: "operator",
        reason,
      },
      pauseReason: "host-limit-active",
      resumeStatus: previousStatus,
    };
  } else if (options.event === "resume") {
    nextStatus = workflowResumeStatus(budget, nextStatus);
    budget = {
      ...budget,
      hostLimit: previousStatus === "paused-host-limit" ? null : budget.hostLimit,
      pauseReason: null,
      resumeStatus: null,
    };
  } else {
    budget = {
      ...budget,
      pauseReason: reason,
      resumeStatus: previousStatus,
    };
  }
  const intervention = {
    event: options.event,
    taskId: null,
    checkpointId: null,
    classification: null,
    reason,
    actor: "operator",
    recordedAt: timestamp,
    allocation: options.allocation || null,
    operations: options.operations || null,
  };
  const run = {
    ...found.run,
    status: nextStatus,
    updatedAt: timestamp,
    budget,
    interventions: [...found.run.interventions, intervention],
  };
  writeJsonAtomic(found.runPath, run);
  const progress = writeWorkflowProgress(found.runRoot, run, found.definition, { now: new Date(timestamp) });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "workflow-intervention",
    runId: run.runId,
    ...intervention,
  });
  return {
    run,
    checkpoint: null,
    intervention,
    progress,
    ...deriveSchedule(run, found.definition),
  };
}

function transitionIfSupported(table, current, event, transitioner) {
  return table[current] && table[current][event]
    ? transitioner(current, event)
    : current;
}

function interveneWorkflowLifecycle(found, options, timestamp, reason) {
  if (options.taskId) throw new Error(`${options.event} is a run-level workflow lifecycle event.`);
  if (options.event === "continue" && !["approved", "active", "review-pending"].includes(found.run.status)) {
    throw new Error(`Workflow cannot continue from status ${found.run.status}; use the reported recovery action.`);
  }
  const runStatus = options.event === "continue"
    ? found.run.status
    : transitionRun(found.run.status, options.event);
  const checkpoints = [];
  const tasks = found.run.tasks.map((task) => {
    let checkpoint = null;
    let checkpointPath = null;
    if (task.activeCheckpointId) {
      ({ checkpoint, checkpointPath } = getActiveCheckpoint(found, task));
      const checkpointStatus = transitionIfSupported(
        CHECKPOINT_TRANSITIONS,
        checkpoint.status,
        options.event,
        transitionCheckpoint,
      );
      if (checkpointStatus !== checkpoint.status) {
        checkpoint = {
          ...checkpoint,
          status: checkpointStatus,
          interventionState: {
            event: options.event,
            reason,
            recordedAt: timestamp,
          },
        };
        writeJsonAtomic(checkpointPath, checkpoint);
      }
      checkpoints.push(checkpoint);
    }
    return {
      ...task,
      status: transitionIfSupported(TASK_TRANSITIONS, task.status, options.event, transitionTask),
    };
  });
  const intervention = {
    event: options.event,
    taskId: null,
    checkpointId: null,
    classification: null,
    reason,
    actor: "operator",
    recordedAt: timestamp,
  };
  const run = {
    ...found.run,
    status: runStatus,
    updatedAt: timestamp,
    tasks,
    interventions: [...found.run.interventions, intervention],
  };
  writeJsonAtomic(found.runPath, run);
  const progress = writeWorkflowProgress(found.runRoot, run, found.definition, { now: new Date(timestamp) });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "workflow-lifecycle",
    runId: run.runId,
    ...intervention,
  });
  return {
    run,
    checkpoints,
    intervention,
    progress,
    ...deriveSchedule(run, found.definition),
  };
}

function normalizeFailureSignature(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const signature = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9:._-]{2,127}$/.test(signature)) {
    throw new Error("Failure signature must be a normalized lowercase identifier.");
  }
  return signature;
}

function interveneWorkflow(found, options) {
  const timestamp = (options.now || new Date()).toISOString();
  const reason = typeof options.reason === "string" ? options.reason.trim() : "";
  if (!reason) throw new Error("Workflow intervention requires --reason.");
  if (RUN_INTERVENTION_EVENTS.has(options.event)) {
    return interveneWorkflowRun(found, options, timestamp, reason);
  }
  if (RUN_LIFECYCLE_EVENTS.has(options.event)) {
    return interveneWorkflowLifecycle(found, options, timestamp, reason);
  }
  const runtimeTask = found.run.tasks.find((task) => task.id === options.taskId);
  if (!runtimeTask) throw new Error(`Unknown workflow task: ${options.taskId}.`);
  const active = getActiveCheckpoint(found, runtimeTask);
  let taskStatus;
  let runStatus;
  let blocker = runtimeTask.blocker;
  let activeCheckpointId = runtimeTask.activeCheckpointId;
  let checkpoint = active.checkpoint;
  let classification = options.classification || (blocker && blocker.classification) || null;
  let failureHistory = Array.isArray(runtimeTask.failureHistory) ? runtimeTask.failureHistory : [];
  let assignedWorker = runtimeTask.assignedWorker || null;

  if (options.event === "block") {
    const signature = normalizeFailureSignature(options.signature);
    const repeated = signature && failureHistory.some((failure) => failure.signature === signature);
    if (classification === "repeated-failure" && !repeated) {
      throw new Error("repeated-failure is derived only after the same failure signature is observed again.");
    }
    classification = repeated ? "repeated-failure" : validateFailureClassification(classification);
    taskStatus = transitionTask(
      runtimeTask.status,
      ["running", "verifying"].includes(runtimeTask.status) ? classification : "block",
    );
    runStatus = transitionRun(found.run.status, "block");
    blocker = {
      classification,
      reason,
      blockedAt: timestamp,
      waivable: WAIVABLE_FAILURES.has(classification),
    };
    if (checkpoint) {
      checkpoint = {
        ...checkpoint,
        status: transitionCheckpoint(checkpoint.status, classification),
        failureClassification: classification,
        failureSignature: signature,
        interventionState: {
          event: "block",
          reason,
          recordedAt: timestamp,
        },
      };
    }
    failureHistory = [...failureHistory, {
      signature,
      classification,
      reason,
      checkpointId: runtimeTask.activeCheckpointId,
      observedAt: timestamp,
    }];
  } else if (options.event === "retry") {
    if (blocker && blocker.classification === "repeated-failure") {
      throw new Error("Workflow repeated failure requires revise or reassign; ordinary retry is refused.");
    }
    if (blocker && REVISION_REQUIRED_FAILURES.has(blocker.classification)) {
      throw new Error(`Workflow ${blocker.classification} requires workflow revision before another attempt.`);
    }
    if (runtimeTask.attempts > found.run.budget.maxRepairsPerCheckpoint) {
      throw new Error(`Workflow task ${runtimeTask.id} exhausted its repair-attempt budget.`);
    }
    taskStatus = transitionTask(runtimeTask.status, "retry");
    runStatus = transitionRun(found.run.status, "retry");
    activeCheckpointId = null;
    blocker = null;
  } else if (options.event === "reassign") {
    if (!options.workerId) throw new Error("Workflow reassign requires --worker.");
    taskStatus = transitionTask(runtimeTask.status, "reassign");
    runStatus = found.run.status === "blocked"
      ? transitionRun(found.run.status, "reassign")
      : found.run.status;
    activeCheckpointId = null;
    blocker = null;
    assignedWorker = options.workerId;
  } else if (options.event === "waive") {
    classification = assertWaivableClassification(classification);
    taskStatus = transitionTask(runtimeTask.status, "waive");
    runStatus = transitionRun(found.run.status, "waive");
    activeCheckpointId = null;
    blocker = null;
  } else {
    throw new Error(`Unsupported workflow intervention event: ${options.event || "missing"}.`);
  }

  if (checkpoint) writeJsonAtomic(active.checkpointPath, checkpoint);
  const intervention = {
    event: options.event,
    taskId: runtimeTask.id,
    checkpointId: runtimeTask.activeCheckpointId,
    classification,
    reason,
    actor: "operator",
    recordedAt: timestamp,
  };
  const tasks = found.run.tasks.map((task) => (task.id === runtimeTask.id ? {
    ...task,
    status: taskStatus,
    activeCheckpointId,
    blocker,
    failureHistory,
    assignedWorker,
  } : task));
  if (tasks.some((task) => task.status === "blocked")) runStatus = "blocked";
  const run = {
    ...found.run,
    status: runStatus,
    updatedAt: timestamp,
    tasks,
    interventions: [...found.run.interventions, intervention],
  };
  writeJsonAtomic(found.runPath, run);
  const progress = writeWorkflowProgress(found.runRoot, run, found.definition, { now: new Date(timestamp) });
  appendWorkflowEvent(found.runRoot, {
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "workflow-intervention",
    runId: run.runId,
    ...intervention,
  });
  return {
    run,
    checkpoint,
    intervention,
    progress,
    ...deriveSchedule(run, found.definition),
  };
}

function createApprovedRun(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const now = options.now || new Date();
  const timestamp = now.toISOString();
  const digest = digestWorkflowDefinition(options.definition);
  const approvalDigest = digestWorkflowApproval(digest, options.source);
  if (options.expectedApprovalDigest && options.expectedApprovalDigest !== approvalDigest) {
    throw new Error("Workflow source or proposal changed after preview. Run `cewp workflow propose` again and approve its digest.");
  }
  if (!options.expectedApprovalDigest && options.expectedDigest !== digest) {
    throw new Error("Workflow proposal changed after preview. Run `cewp workflow propose` again and approve its digest.");
  }
  const definitionPath = persistApprovedDefinition(repoRoot, options.definition, digest);
  const runId = allocateRunId(repoRoot, options.definition.workflowId, now);
  const runRoot = path.join(repoRoot, ".cewp", "workflow-runs", runId);
  const runPath = path.join(runRoot, "run.json");
  const run = {
    schemaVersion: RUN_STATE_SCHEMA_VERSION,
    runId,
    workflow: {
      id: options.definition.workflowId,
      revision: options.definition.revision.number,
      digest,
      definitionPath: normalizeSlashPath(path.relative(repoRoot, definitionPath)),
    },
    status: "approved",
    createdAt: timestamp,
    updatedAt: timestamp,
    goal: options.definition.goal,
    execution: options.definition.execution,
    assurance: options.definition.assurance,
    checkpointPolicy: options.definition.checkpointPolicy,
    reviewerPolicy: options.definition.reviewerPolicy,
    tasks: options.definition.tasks.map((task) => ({
      id: task.id,
      status: task.dependsOn.length === 0 ? "ready" : "pending",
      attempts: 0,
      activeCheckpointId: null,
      resultId: null,
      verification: null,
      blocker: null,
      failureHistory: [],
      assignedWorker: null,
      stateHistory: [],
    })),
    budget: makeRuntimeBudget(options.definition.budget),
    approval: {
      actor: "operator",
      approvedAt: timestamp,
      digest: approvalDigest,
      definitionDigest: digest,
      source: options.source,
    },
    reviewer: {
      status: options.definition.reviewerPolicy.requiredForFinalize ? "pending" : "not-required",
      decision: null,
    },
    reviewHistory: [],
    revisionHistory: [],
    interventions: [],
    warnings: [],
  };
  writeJsonAtomic(runPath, run);
  fs.writeFileSync(path.join(runRoot, "events.jsonl"), `${JSON.stringify({
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "workflow-approved",
    runId,
    workflowId: options.definition.workflowId,
    revision: options.definition.revision.number,
    digest,
    approvalDigest,
    actor: "operator",
  })}\n`, { flag: "wx" });
  writeWorkflowProgress(runRoot, run, options.definition, { now });
  return {
    run,
    definitionPath: normalizeSlashPath(path.relative(repoRoot, definitionPath)),
    runPath: normalizeSlashPath(path.relative(repoRoot, runPath)),
  };
}

module.exports = {
  RUN_STATE_SCHEMA_VERSION,
  applyWorkflowRevision,
  createApprovedRun,
  finalizeWorkflowRun,
  interveneWorkflow,
  RUN_INTERVENTION_EVENTS,
  loadWorkflowRun,
  recordWorkflowReview,
  recordWorkflowResult,
  startWorkflowTask,
  validateWorkflowRunId,
  writeWorkflowProgress,
  writeJsonAtomic,
};
