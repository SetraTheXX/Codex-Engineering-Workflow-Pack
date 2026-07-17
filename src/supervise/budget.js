"use strict";

const { appendEvent, getNextAction, writeCanonicalRun } = require("./state");

const PROTECTED_ALLOCATIONS = new Set(["reviewer", "finalization"]);

function isCheckpointSafe(run) {
  const status = run.tasks[0].status;
  return ["proposed", "ready", "verified", "completed", "cancelled"].includes(status);
}

function pauseStatusFor(run) {
  return isCheckpointSafe(run) ? "paused-budget-safe" : "paused-budget-unverified";
}

function elapsedMinutes(run, now) {
  const start = Date.parse(
    (run.approval && run.approval.approvedAt)
      || run.createdAt,
  );
  if (Number.isNaN(start)) return 0;
  return Math.max(0, (now.getTime() - start) / 60000);
}

function evaluateOperationBudget(run, allocation, options = {}) {
  const now = options.now || new Date();
  const budget = run.budget;
  if (!budget.allocations[allocation]) {
    throw new Error(`Unknown budget allocation: ${allocation}.`);
  }
  if (budget.hostLimit && budget.hostLimit.active) {
    return {
      allowed: false,
      reason: "host-limit-active",
      pauseStatus: "paused-host-limit",
      warning: "host-limit",
    };
  }

  const consumed = budget.consumed.modelOperations;
  const maximum = budget.modelOperations.value;
  const percent = maximum === 0 ? 100 : (consumed / maximum) * 100;
  if (consumed >= maximum) {
    return {
      allowed: false,
      reason: "absolute-ceiling-exhausted",
      pauseStatus: pauseStatusFor(run),
      warning: "budget-absolute-ceiling",
      percent,
    };
  }
  if (elapsedMinutes(run, now) >= budget.maxElapsedMinutes.value) {
    return {
      allowed: false,
      reason: "elapsed-time-ceiling-exhausted",
      pauseStatus: pauseStatusFor(run),
      warning: "budget-elapsed-ceiling",
      percent,
    };
  }

  const allocationConsumed = budget.consumed.allocations[allocation];
  const allocationMaximum = budget.allocations[allocation].value;
  if (allocationConsumed >= allocationMaximum) {
    return {
      allowed: false,
      reason: `${allocation}-allocation-exhausted`,
      pauseStatus: pauseStatusFor(run),
      warning: "budget-allocation-exhausted",
      percent,
    };
  }

  const reserveThreshold = budget.thresholds.reservePercent.value;
  const protectedAllocation = PROTECTED_ALLOCATIONS.has(allocation)
    || budget.protectedAllocations.includes(allocation);
  if (percent >= reserveThreshold && !protectedAllocation) {
    return {
      allowed: false,
      reason: "completion-reserve-protected",
      pauseStatus: pauseStatusFor(run),
      warning: "budget-reserve-threshold",
      percent,
    };
  }

  return {
    allowed: true,
    reason: "budget-allows-operation",
    pauseStatus: null,
    warning: percent >= budget.thresholds.earlyWarningPercent.value
      ? "budget-early-warning"
      : null,
    percent,
    protectedAllocation,
  };
}

function pauseForBudget(found, allocation, decision, now = new Date()) {
  const timestamp = now.toISOString();
  const run = {
    ...found.run,
    status: decision.pauseStatus,
    updatedAt: timestamp,
    pause: {
      status: decision.pauseStatus,
      reason: decision.reason,
      allocation,
      pausedAt: timestamp,
      previousRunStatus: found.run.status,
      previousTaskStatus: found.run.tasks[0].status,
      actions: ["add-budget", "reduce-scope", "resume-later", "rollback", "abandon"],
    },
  };
  writeCanonicalRun(found.runRoot, run);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp,
    type: decision.pauseStatus,
    runId: found.runId,
    reason: decision.reason,
    allocation,
  });
  return { run, nextAction: getNextAction(run) };
}

function enforceOperationBudget(found, allocation, options = {}) {
  const decision = evaluateOperationBudget(found.run, allocation, options);
  if (!decision.allowed) {
    pauseForBudget(found, allocation, decision, options.now || new Date());
    const error = new Error(`Controlled operation paused: ${decision.pauseStatus} (${decision.reason}).`);
    error.code = decision.reason;
    error.pauseStatus = decision.pauseStatus;
    throw error;
  }
  return decision;
}

function applyThresholdObservation(run, allocation, timestamp = new Date().toISOString()) {
  const budget = JSON.parse(JSON.stringify(run.budget));
  const percent = budget.modelOperations.value === 0
    ? 100
    : (budget.consumed.modelOperations / budget.modelOperations.value) * 100;
  let threshold = null;
  if (percent >= budget.thresholds.absoluteCeilingPercent.value) threshold = "absolute";
  else if (percent >= budget.thresholds.reservePercent.value) threshold = "reserve";
  else if (percent >= budget.thresholds.earlyWarningPercent.value) threshold = "early";
  if (!threshold || budget.thresholdEvents.some((entry) => entry.threshold === threshold)) {
    return { run, event: null };
  }
  const event = {
    threshold,
    percent,
    allocation,
    observedAt: timestamp,
  };
  budget.thresholdEvents.push(event);
  return {
    run: {
      ...run,
      budget,
      warnings: [...run.warnings, `Budget ${threshold} threshold reached at ${percent.toFixed(1)}%.`],
    },
    event,
  };
}

module.exports = {
  applyThresholdObservation,
  enforceOperationBudget,
  evaluateOperationBudget,
  isCheckpointSafe,
  pauseForBudget,
};
