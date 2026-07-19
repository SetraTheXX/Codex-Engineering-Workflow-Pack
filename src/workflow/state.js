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
const { validateTaskResult } = require("./result");
const {
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
  if (consumedOperations > found.run.budget.modelOperations) {
    throw new Error("Task result would exceed the workflow absolute model-operation ceiling.");
  }
  if (consumedAllocation > found.run.budget.allocations[activeAllocation]) {
    throw new Error(`Task result would exceed the workflow ${activeAllocation} allocation.`);
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

function interveneWorkflowRun(found, options, timestamp, reason) {
  let budget = found.run.budget;
  const previousStatus = found.run.status;
  const nextStatus = transitionRun(previousStatus, options.event);
  if (options.event === "add-budget") {
    if (!Number.isInteger(options.operations) || options.operations < 1) {
      throw new Error("add-budget requires --operations with a positive integer.");
    }
    if (!options.allocation || !Object.hasOwn(budget.allocations, options.allocation)) {
      throw new Error("add-budget requires one approved model-operation --allocation.");
    }
    const previousModelOperations = budget.modelOperations;
    budget = {
      ...budget,
      modelOperations: previousModelOperations + options.operations,
      allocations: {
        ...budget.allocations,
        [options.allocation]: budget.allocations[options.allocation] + options.operations,
      },
      pauseReason: null,
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
    };
  } else if (options.event === "resume") {
    budget = {
      ...budget,
      hostLimit: previousStatus === "paused-host-limit" ? null : budget.hostLimit,
      pauseReason: null,
    };
  } else {
    budget = {
      ...budget,
      pauseReason: reason,
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

function interveneWorkflow(found, options) {
  const timestamp = (options.now || new Date()).toISOString();
  const reason = typeof options.reason === "string" ? options.reason.trim() : "";
  if (!reason) throw new Error("Workflow intervention requires --reason.");
  if (RUN_INTERVENTION_EVENTS.has(options.event)) {
    return interveneWorkflowRun(found, options, timestamp, reason);
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

  if (options.event === "block") {
    classification = validateFailureClassification(classification);
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
        interventionState: {
          event: "block",
          reason,
          recordedAt: timestamp,
        },
      };
    }
  } else if (options.event === "retry") {
    if (runtimeTask.attempts > found.run.budget.maxRepairsPerCheckpoint) {
      throw new Error(`Workflow task ${runtimeTask.id} exhausted its repair-attempt budget.`);
    }
    taskStatus = transitionTask(runtimeTask.status, "retry");
    runStatus = transitionRun(found.run.status, "retry");
    activeCheckpointId = null;
    blocker = null;
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
  if (options.expectedDigest !== digest) {
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
    })),
    budget: makeRuntimeBudget(options.definition.budget),
    approval: {
      actor: "operator",
      approvedAt: timestamp,
      digest,
      source: options.source,
    },
    reviewer: {
      status: options.definition.reviewerPolicy.requiredForFinalize ? "pending" : "not-required",
      decision: null,
    },
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
  createApprovedRun,
  interveneWorkflow,
  RUN_INTERVENTION_EVENTS,
  loadWorkflowRun,
  recordWorkflowResult,
  startWorkflowTask,
  validateWorkflowRunId,
  writeWorkflowProgress,
  writeJsonAtomic,
};
