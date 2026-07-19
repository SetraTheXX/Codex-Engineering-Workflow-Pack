"use strict";

const crypto = require("node:crypto");
const { normalizeSlashPath } = require("../lib/paths");
const { validateVerificationCommand } = require("../supervise/commands");
const { validateProfile, validateTestAuthoring } = require("../supervise/profiles");
const { validateTaskGraph, validateTaskScopeOverlaps } = require("./graph");

const WORKFLOW_DEFINITION_SCHEMA_VERSION = "workflow-definition/v1";
const BUDGET_ENVELOPE_SCHEMA_VERSION = "budget-envelope/v1";
const TASK_RISKS = Object.freeze(["low", "medium", "high", "critical"]);
const OPERATING_MODES = Object.freeze(["supervised", "autonomous", "audit-only"]);
const ALLOCATION_NAMES = Object.freeze([
  "implementation", "repair", "completion", "reviewer", "finalization",
]);
const VAGUE_STOPPING_CONDITIONS = new Set([
  "all good", "complete", "completed", "done", "finished", "it works", "looks good", "task complete", "works",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false.`);
  }
  return value;
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function normalizeId(value, label) {
  const id = requiredText(value, label);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error(`${label} must use lowercase letters, digits, and hyphens.`);
  }
  return id;
}

function normalizeTextList(value, label, options = {}) {
  if (!Array.isArray(value) || (options.required && value.length === 0)) {
    throw new Error(`${label} must be ${options.required ? "a non-empty" : "an"} array.`);
  }
  const normalized = value.map((entry, index) => requiredText(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return normalized;
}

function normalizeScope(value, label) {
  const scope = normalizeSlashPath(requiredText(value, label)).replace(/^\.\//, "");
  if (
    scope === "."
    || scope === ".."
    || scope.startsWith("../")
    || scope.includes("/../")
    || scope.startsWith("/")
    || /^[a-zA-Z]:\//.test(scope)
    || scope === ".git"
    || scope.startsWith(".git/")
  ) {
    throw new Error(`${label} must be a safe repository-relative path.`);
  }
  return scope;
}

function normalizeScopeList(value, label, required) {
  return normalizeTextList(value, label, { required })
    .map((entry, index) => normalizeScope(entry, `${label}[${index}]`));
}

function normalizeVerification(value, label) {
  if (!isObject(value)) throw new Error(`${label} is required.`);
  const targeted = normalizeTextList(value.targeted, `${label}.targeted`, { required: false });
  const full = normalizeTextList(value.full, `${label}.full`, { required: false });
  if (targeted.length + full.length === 0) {
    throw new Error(`${label} requires at least one targeted or full command.`);
  }
  for (const command of [...targeted, ...full]) validateVerificationCommand(command);
  return { targeted, full };
}

function normalizeStoppingConditions(value, label) {
  const conditions = normalizeTextList(value, label, { required: true });
  for (const condition of conditions) {
    const comparable = condition.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (VAGUE_STOPPING_CONDITIONS.has(comparable)) {
      throw new Error(`${label} contains a vague stopping condition: ${condition}. Require an observable outcome.`);
    }
  }
  return conditions;
}

function normalizeTask(value, index) {
  if (!isObject(value)) throw new Error(`tasks[${index}] must be an object.`);
  const id = normalizeId(value.id, `tasks[${index}].id`);
  const allowedFiles = normalizeScopeList(value.allowedFiles, `tasks[${index}].allowedFiles`, true);
  if (allowedFiles.length > 8) {
    throw new Error(`Workflow task ${id} is too broad: use at most 8 independent write scopes per micro-goal.`);
  }
  const risk = requiredText(value.risk, `tasks[${index}].risk`);
  if (!TASK_RISKS.includes(risk)) {
    throw new Error(`tasks[${index}].risk must be ${TASK_RISKS.join(", ")}.`);
  }
  return {
    id,
    title: requiredText(value.title, `tasks[${index}].title`),
    dependsOn: normalizeTextList(value.dependsOn, `tasks[${index}].dependsOn`, { required: false })
      .map((entry, dependencyIndex) => normalizeId(entry, `tasks[${index}].dependsOn[${dependencyIndex}]`)),
    allowedFiles,
    forbiddenFiles: normalizeScopeList(value.forbiddenFiles, `tasks[${index}].forbiddenFiles`, false),
    stoppingConditions: normalizeStoppingConditions(
      value.stoppingConditions,
      `tasks[${index}].stoppingConditions`,
    ),
    verification: normalizeVerification(value.verification, `tasks[${index}].verification`),
    risk,
  };
}

function normalizeBudget(value) {
  if (!isObject(value) || value.schemaVersion !== BUDGET_ENVELOPE_SCHEMA_VERSION) {
    throw new Error(`budget must use ${BUDGET_ENVELOPE_SCHEMA_VERSION}.`);
  }
  if (!isObject(value.allocations)) throw new Error("budget.allocations is required.");
  const modelOperations = boundedInteger(value.modelOperations, "budget.modelOperations", 1, 10000);
  const allocations = {};
  for (const name of ALLOCATION_NAMES) {
    allocations[name] = boundedInteger(value.allocations[name], `budget.allocations.${name}`, 0, modelOperations);
  }
  const unknownAllocations = Object.keys(value.allocations).filter((name) => !ALLOCATION_NAMES.includes(name));
  if (unknownAllocations.length > 0) {
    throw new Error(`budget.allocations contains unsupported names: ${unknownAllocations.join(", ")}.`);
  }
  const allocationTotal = Object.values(allocations).reduce((total, count) => total + count, 0);
  if (allocationTotal !== modelOperations) {
    throw new Error("budget allocations must equal budget.modelOperations.");
  }
  const protectedAllocations = normalizeTextList(
    value.protectedAllocations,
    "budget.protectedAllocations",
    { required: true },
  );
  for (const required of ["completion", "reviewer", "finalization"]) {
    if (!protectedAllocations.includes(required)) {
      throw new Error(`budget.protectedAllocations must include ${required}.`);
    }
    if (allocations[required] < 1) {
      throw new Error(`budget ${required} allocation must reserve at least one operation.`);
    }
  }
  if (!isObject(value.thresholds)) throw new Error("budget.thresholds is required.");
  const thresholds = {
    earlyWarningPercent: boundedInteger(value.thresholds.earlyWarningPercent, "budget.thresholds.earlyWarningPercent", 1, 98),
    reservePercent: boundedInteger(value.thresholds.reservePercent, "budget.thresholds.reservePercent", 2, 99),
    absoluteCeilingPercent: boundedInteger(value.thresholds.absoluteCeilingPercent, "budget.thresholds.absoluteCeilingPercent", 100, 100),
  };
  if (thresholds.earlyWarningPercent >= thresholds.reservePercent) {
    throw new Error("budget early warning must be below the reserve threshold.");
  }
  return {
    schemaVersion: BUDGET_ENVELOPE_SCHEMA_VERSION,
    modelOperations,
    allocations,
    protectedAllocations,
    maxRepairsPerCheckpoint: boundedInteger(value.maxRepairsPerCheckpoint, "budget.maxRepairsPerCheckpoint", 0, 20),
    maxElapsedMinutes: boundedInteger(value.maxElapsedMinutes, "budget.maxElapsedMinutes", 1, 10080),
    maxConcurrentWorkers: boundedInteger(value.maxConcurrentWorkers, "budget.maxConcurrentWorkers", 1, 16),
    maxCapturedOutputBytes: boundedInteger(value.maxCapturedOutputBytes, "budget.maxCapturedOutputBytes", 1024, 10485760),
    maxTargetedVerificationRuns: boundedInteger(value.maxTargetedVerificationRuns, "budget.maxTargetedVerificationRuns", 1, 10000),
    maxFullVerificationRuns: boundedInteger(value.maxFullVerificationRuns, "budget.maxFullVerificationRuns", 0, 1000),
    thresholds,
  };
}

function normalizeExecution(value) {
  if (!isObject(value)) throw new Error("execution is required.");
  const owner = requiredText(value.owner, "execution.owner");
  if (!["managed", "native", "audit-only"].includes(owner)) {
    throw new Error("execution.owner must be managed, native, or audit-only.");
  }
  const backend = value.backend === null ? null : requiredText(value.backend, "execution.backend");
  if (owner === "managed" && backend !== "codex-exec") {
    throw new Error("Phase 10 managed workflows require the codex-exec backend.");
  }
  if (owner !== "managed" && backend !== null) {
    throw new Error(`${owner} workflows must not claim a managed backend.`);
  }
  const allowedModes = normalizeTextList(value.allowedModes, "execution.allowedModes", { required: true });
  for (const mode of allowedModes) {
    if (!OPERATING_MODES.includes(mode)) {
      throw new Error(`Unsupported operating mode: ${mode}.`);
    }
    if (owner === "audit-only" && mode !== "audit-only") {
      throw new Error("audit-only ownership permits only audit-only mode.");
    }
    if (owner !== "audit-only" && mode === "audit-only") {
      throw new Error(`${owner} ownership cannot claim audit-only mode.`);
    }
  }
  return { owner, backend, allowedModes };
}

function assertVerificationBudgetFits(tasks, budget) {
  const targetedCommands = tasks.reduce((total, task) => total + task.verification.targeted.length, 0);
  const requiredTargetedRuns = targetedCommands * (2 + budget.maxRepairsPerCheckpoint);
  if (requiredTargetedRuns > budget.maxTargetedVerificationRuns) {
    throw new Error(
      `Workflow targeted verification budget requires ${requiredTargetedRuns} runs, but only ${budget.maxTargetedVerificationRuns} are approved.`,
    );
  }
  const requiredFullRuns = tasks.reduce((total, task) => total + task.verification.full.length, 0);
  if (requiredFullRuns > budget.maxFullVerificationRuns) {
    throw new Error(
      `Workflow full verification budget requires ${requiredFullRuns} runs, but only ${budget.maxFullVerificationRuns} are approved.`,
    );
  }
}

function validateWorkflowDefinition(value) {
  if (!isObject(value) || value.schemaVersion !== WORKFLOW_DEFINITION_SCHEMA_VERSION) {
    throw new Error(`Workflow definition must use ${WORKFLOW_DEFINITION_SCHEMA_VERSION}.`);
  }
  if (!isObject(value.revision)) throw new Error("revision is required.");
  const revisionNumber = boundedInteger(value.revision.number, "revision.number", 1, 1000000);
  const parent = value.revision.parent === null
    ? null
    : requiredText(value.revision.parent, "revision.parent");
  if (revisionNumber === 1 && parent !== null) {
    throw new Error("Initial workflow revision must have a null parent.");
  }
  if (revisionNumber > 1 && (parent === null || !/^sha256:[a-f0-9]{64}$/.test(parent))) {
    throw new Error("Non-initial workflow revision must reference its parent sha256 digest.");
  }
  if (!Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > 256) {
    throw new Error("tasks must contain from 1 to 256 bounded tasks.");
  }
  let tasks = value.tasks.map(normalizeTask);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new Error("Workflow task ids must be unique.");
  }
  tasks = validateTaskGraph(tasks);
  validateTaskScopeOverlaps(tasks);
  if (!isObject(value.assurance)) throw new Error("assurance is required.");
  validateProfile(value.assurance.profile);
  validateTestAuthoring(value.assurance.testAuthoring);
  if (!isObject(value.checkpointPolicy)) throw new Error("checkpointPolicy is required.");
  if (!isObject(value.reviewerPolicy)) throw new Error("reviewerPolicy is required.");
  const budget = normalizeBudget(value.budget);
  assertVerificationBudgetFits(tasks, budget);

  return {
    schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
    workflowId: normalizeId(value.workflowId, "workflowId"),
    revision: {
      number: revisionNumber,
      parent,
      reason: requiredText(value.revision.reason, "revision.reason"),
    },
    goal: requiredText(value.goal, "goal"),
    tasks,
    assurance: {
      profile: value.assurance.profile,
      testAuthoring: value.assurance.testAuthoring,
    },
    checkpointPolicy: {
      required: requiredBoolean(value.checkpointPolicy.required, "checkpointPolicy.required"),
      reviewerAfterEachTask: requiredBoolean(
        value.checkpointPolicy.reviewerAfterEachTask,
        "checkpointPolicy.reviewerAfterEachTask",
      ),
    },
    reviewerPolicy: {
      requiredForFinalize: requiredBoolean(
        value.reviewerPolicy.requiredForFinalize,
        "reviewerPolicy.requiredForFinalize",
      ),
    },
    execution: normalizeExecution(value.execution),
    budget,
  };
}

function digestWorkflowDefinition(definition) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(definition)).digest("hex")}`;
}

module.exports = {
  BUDGET_ENVELOPE_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  digestWorkflowDefinition,
  validateWorkflowDefinition,
};
