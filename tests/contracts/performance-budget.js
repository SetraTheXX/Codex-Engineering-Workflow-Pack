"use strict";

const { assert } = require("../harness/lib/assertions");
const { PERFORMANCE_BUDGET_SCHEMA_VERSION, buildPerformanceBudgets, evaluatePerformanceMeasurement } = require("../../src/performance/budgets");

function runContract() {
  const policy = buildPerformanceBudgets();
  assert(policy.schemaVersion === PERFORMANCE_BUDGET_SCHEMA_VERSION, "performance budget is versioned");
  assert(policy.exclusions.includes("model-execution"), "model execution is excluded from CEWP speed guarantees");
  assert(policy.exclusions.includes("repository-verification-command"), "repository commands are excluded from CEWP bookkeeping budgets");
  for (const id of ["doctor-json", "workflow-validation", "status-progress", "checkpoint-bookkeeping", "package-lifecycle", "large-run-inspection"]) {
    assert(Number.isFinite(policy.operations[id].ceilingMs), `${id} has a finite CEWP-owned ceiling`);
  }
  const passing = evaluatePerformanceMeasurement(policy, { operation: "doctor-json", durationMs: 125, excludedDurationMs: 0 });
  assert(passing.status === "within-budget", "bounded measurement passes");
  const failing = evaluatePerformanceMeasurement(policy, { operation: "doctor-json", durationMs: 2500, excludedDurationMs: 0 });
  assert(failing.status === "over-budget" && failing.releaseBlocking === true, "CEWP overhead regression is release-blocking");
  const invalid = evaluatePerformanceMeasurement(policy, { operation: "checkpoint-bookkeeping", durationMs: 100, excludedDurationMs: 150 });
  assert(invalid.status === "invalid-measurement", "excluded model or command time cannot exceed the sample");
}

try {
  runContract();
  console.log("[PASS] CEWP-owned performance budgets exclude model execution");
} catch (error) {
  console.error("[FAIL] performance budget contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
