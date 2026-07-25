"use strict";

const PERFORMANCE_BUDGET_SCHEMA_VERSION = "performance-budget/v1";

function buildPerformanceBudgets() {
  return {
    schemaVersion: PERFORMANCE_BUDGET_SCHEMA_VERSION,
    scope: "cewp-controlled-overhead-only",
    exclusions: [
      "model-execution",
      "network-latency",
      "host-queue-time",
      "repository-verification-command",
    ],
    operations: {
      "doctor-json": { ceilingMs: 2000 },
      "workflow-validation": { ceilingMs: 1000 },
      "status-progress": { ceilingMs: 1000 },
      "checkpoint-bookkeeping": { ceilingMs: 1000 },
      "package-lifecycle": { ceilingMs: 30000 },
      "large-run-inspection": { ceilingMs: 3000 },
    },
    reporting: {
      requiredStatistics: ["repetitions", "medianMs", "upperQuantileMs", "maximumMs"],
      requiredEnvironment: ["os", "node", "git", "packageVersion", "fixtureShape"],
      modelAndUsageReportedSeparately: true,
      pricingSnapshotRequiresDate: true,
      unknownHostUsageRemainsUnknown: true,
    },
  };
}

function evaluatePerformanceMeasurement(policy, measurement) {
  const budget = policy.operations[measurement.operation];
  if (!budget) throw new Error(`Unknown performance operation: ${measurement.operation || "missing"}.`);
  if (!Number.isFinite(measurement.durationMs) || measurement.durationMs < 0
    || !Number.isFinite(measurement.excludedDurationMs) || measurement.excludedDurationMs < 0
    || measurement.excludedDurationMs > measurement.durationMs) {
    return { status: "invalid-measurement", releaseBlocking: true };
  }
  const ownedDurationMs = measurement.durationMs - measurement.excludedDurationMs;
  const withinBudget = ownedDurationMs <= budget.ceilingMs;
  return {
    status: withinBudget ? "within-budget" : "over-budget",
    releaseBlocking: !withinBudget,
    operation: measurement.operation,
    ownedDurationMs,
    ceilingMs: budget.ceilingMs,
  };
}

module.exports = { PERFORMANCE_BUDGET_SCHEMA_VERSION, buildPerformanceBudgets, evaluatePerformanceMeasurement };
