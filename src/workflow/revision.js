"use strict";

const { digestWorkflowDefinition, validateWorkflowDefinition } = require("./definition");

const REVISIONABLE_RUN_STATUSES = new Set([
  "approved",
  "active",
  "blocked",
  "timed-out",
  "paused-budget-safe",
  "paused-budget-unverified",
  "paused-host-limit",
]);

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertBudgetRetainsConsumption(run, definition) {
  if (definition.budget.modelOperations < run.budget.consumed.modelOperations) {
    throw new Error("Workflow revision budget cannot fall below observed model operations.");
  }
  for (const [allocation, consumed] of Object.entries(run.budget.consumed.allocations)) {
    if (definition.budget.allocations[allocation] < consumed) {
      throw new Error(`Workflow revision ${allocation} allocation cannot fall below observed consumption.`);
    }
  }
  for (const [field, consumedField] of [
    ["maxTargetedVerificationRuns", "targetedVerificationRuns"],
    ["maxFullVerificationRuns", "fullVerificationRuns"],
    ["maxCapturedOutputBytes", "capturedOutputBytes"],
  ]) {
    if (definition.budget[field] < run.budget.consumed[consumedField]) {
      throw new Error(`Workflow revision ${field} cannot fall below observed consumption.`);
    }
  }
}

function validateWorkflowRevision(run, currentDefinition, candidate) {
  const definition = validateWorkflowDefinition(candidate);
  if (!REVISIONABLE_RUN_STATUSES.has(run.status)) {
    throw new Error(`Workflow run ${run.runId} cannot revise from status ${run.status}.`);
  }
  if (run.tasks.some((task) => ["running", "verifying"].includes(task.status))) {
    throw new Error("Workflow revision requires a safe boundary with no active checkpoint.");
  }
  if (definition.workflowId !== currentDefinition.workflowId) {
    throw new Error("Workflow revision cannot change workflowId.");
  }
  if (definition.revision.number !== currentDefinition.revision.number + 1) {
    throw new Error("Workflow revision number must increment by exactly one.");
  }
  if (definition.revision.parent !== run.workflow.digest) {
    throw new Error("Workflow revision parent must match the currently approved digest.");
  }
  if (!sameValue(definition.execution, currentDefinition.execution)) {
    throw new Error("Workflow revision cannot change execution owner or backend within an existing run.");
  }
  const currentById = new Map(currentDefinition.tasks.map((task) => [task.id, task]));
  const proposedById = new Map(definition.tasks.map((task) => [task.id, task]));
  for (const runtimeTask of run.tasks.filter((task) => task.status === "completed")) {
    const currentTask = currentById.get(runtimeTask.id);
    const proposedTask = proposedById.get(runtimeTask.id);
    if (!proposedTask || !sameValue(currentTask, proposedTask)) {
      throw new Error(`Workflow revision cannot remove or rewrite completed task ${runtimeTask.id}.`);
    }
  }
  for (const runtimeTask of run.tasks.filter((task) => task.status !== "completed")) {
    if (proposedById.has(runtimeTask.id) && Math.max(0, runtimeTask.attempts - 1) > definition.budget.maxRepairsPerCheckpoint) {
      throw new Error(`Workflow revision repair limit is below prior attempts for task ${runtimeTask.id}.`);
    }
  }
  assertBudgetRetainsConsumption(run, definition);
  return definition;
}

function previewWorkflowRevision(run, currentDefinition, candidate) {
  const definition = validateWorkflowRevision(run, currentDefinition, candidate);
  const currentById = new Map(currentDefinition.tasks.map((task) => [task.id, task]));
  const proposedById = new Map(definition.tasks.map((task) => [task.id, task]));
  return {
    definition,
    digest: digestWorkflowDefinition(definition),
    diff: {
      baseRevision: currentDefinition.revision.number,
      proposedRevision: definition.revision.number,
      reason: definition.revision.reason,
      goalChanged: currentDefinition.goal !== definition.goal,
      budgetChanged: !sameValue(currentDefinition.budget, definition.budget),
      addedTasks: definition.tasks.filter((task) => !currentById.has(task.id)).map((task) => task.id),
      removedTasks: currentDefinition.tasks.filter((task) => !proposedById.has(task.id)).map((task) => task.id),
      changedTasks: definition.tasks.filter((task) => (
        currentById.has(task.id) && !sameValue(currentById.get(task.id), task)
      )).map((task) => task.id),
    },
  };
}

module.exports = {
  REVISIONABLE_RUN_STATUSES,
  previewWorkflowRevision,
  validateWorkflowRevision,
};
