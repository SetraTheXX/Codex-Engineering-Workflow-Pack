"use strict";

function hasUnverifiedWork(run) {
  return run.tasks.some((task) => ["running", "verifying"].includes(task.status));
}

function pauseStatusFor(run) {
  return hasUnverifiedWork(run) ? "paused-budget-unverified" : "paused-budget-safe";
}

function elapsedMinutes(run, now) {
  const start = Date.parse((run.approval && run.approval.approvedAt) || run.createdAt);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, (now.getTime() - start) / 60000);
}

function evaluateWorkflowOperation(run, allocation, options = {}) {
  const now = options.now || new Date();
  const budget = run.budget;
  if (!budget || !budget.allocations || !Object.hasOwn(budget.allocations, allocation)) {
    throw new Error(`Unknown workflow budget allocation: ${allocation}.`);
  }
  if (budget.hostLimit && budget.hostLimit.active) {
    return {
      allowed: false,
      reason: "host-limit-active",
      pauseStatus: "paused-host-limit",
      warning: "host-limit",
      percent: null,
      protectedAllocation: false,
    };
  }
  const consumed = budget.consumed.modelOperations;
  const maximum = budget.modelOperations;
  const percent = maximum === 0 ? 100 : (consumed / maximum) * 100;
  const protectedAllocation = budget.protectedAllocations.includes(allocation);
  if (consumed >= maximum) {
    return {
      allowed: false,
      reason: "absolute-ceiling-exhausted",
      pauseStatus: pauseStatusFor(run),
      warning: "budget-absolute-ceiling",
      percent,
      protectedAllocation,
    };
  }
  if (elapsedMinutes(run, now) >= budget.maxElapsedMinutes) {
    return {
      allowed: false,
      reason: "elapsed-time-ceiling-exhausted",
      pauseStatus: pauseStatusFor(run),
      warning: "budget-elapsed-ceiling",
      percent,
      protectedAllocation,
    };
  }
  if (budget.consumed.allocations[allocation] >= budget.allocations[allocation]) {
    return {
      allowed: false,
      reason: `${allocation}-allocation-exhausted`,
      pauseStatus: pauseStatusFor(run),
      warning: "budget-allocation-exhausted",
      percent,
      protectedAllocation,
    };
  }
  if (percent >= budget.thresholds.reservePercent && !protectedAllocation) {
    return {
      allowed: false,
      reason: "completion-reserve-protected",
      pauseStatus: pauseStatusFor(run),
      warning: "budget-reserve-threshold",
      percent,
      protectedAllocation,
    };
  }
  return {
    allowed: true,
    reason: "budget-allows-operation",
    pauseStatus: null,
    warning: percent >= budget.thresholds.earlyWarningPercent ? "budget-early-warning" : null,
    percent,
    protectedAllocation,
  };
}

module.exports = {
  evaluateWorkflowOperation,
  hasUnverifiedWork,
  pauseStatusFor,
};
