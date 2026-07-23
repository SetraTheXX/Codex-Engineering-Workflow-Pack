"use strict";

const RUN_COMPARISON_SCHEMA_VERSION = "run-comparison/v1";

function observed(value, source = "cewp-run-state") {
  return { label: "observed", value, source };
}

function unknown(reason) {
  return { label: "unknown", value: null, reason };
}

function duration(receipt) {
  const start = Date.parse(receipt.timestamps.createdAt);
  const end = Date.parse(receipt.timestamps.finalizedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return unknown("run is not finalized with a bounded duration");
  return observed(end - start, "cewp-run-timestamps");
}

function commandCount(receipt) {
  return receipt.commands.reduce((total, task) => (
    total
      + (task.verification.baseline ? 1 : 0)
      + task.verification.targeted.length
      + task.verification.full.length
  ), 0);
}

function failureSummary(receipt) {
  const failures = receipt.tasks.flatMap((task) => task.failure ? [{ taskId: task.id, ...task.failure }] : []);
  return { count: failures.length, entries: failures };
}

function scopeSummary(receipt) {
  return {
    passed: receipt.tasks.filter((task) => task.scopeVerdict.status === "passed").length,
    unknown: receipt.tasks.filter((task) => task.scopeVerdict.status === "unknown").length,
    changedFiles: [...new Set(receipt.tasks.flatMap((task) => task.changedFiles))].sort(),
  };
}

function verificationSummary(receipt) {
  const evidence = receipt.tasks.flatMap((task) => [
    ...(task.verification.baseline.evidence || []),
    ...task.verification.targeted,
    ...task.verification.full,
  ]);
  return {
    commandCount: commandCount(receipt),
    passedEvidence: evidence.filter((entry) => entry.status === "passed").length,
    failedEvidence: evidence.filter((entry) => entry.status === "failed").length,
    evidence,
  };
}

function summarizeRun(receipt) {
  const nativeGoal = receipt.integration && receipt.integration.nativeGoal;
  return {
    runId: receipt.runId,
    execution: receipt.execution,
    nativeGoalBaseline: Boolean(nativeGoal && nativeGoal.status === "known"),
    nativeGoalEvidence: nativeGoal || unknown("no supported native goal binding"),
  };
}

function delta(left, right) {
  if (left.label !== "observed" || right.label !== "observed") return unknown("both comparison values must be observed");
  return observed(right.value - left.value, "derived-from-observed-values");
}

function compareEvidenceReceipts(left, right) {
  if (!left || left.schemaVersion !== "evidence-receipt/v1" || !right || right.schemaVersion !== "evidence-receipt/v1") {
    throw new Error("Run comparison requires two evidence-receipt/v1 values.");
  }
  const leftDuration = duration(left);
  const rightDuration = duration(right);
  const leftAttempts = observed(left.tasks.reduce((total, task) => total + task.attempts, 0));
  const rightAttempts = observed(right.tasks.reduce((total, task) => total + task.attempts, 0));
  const leftInterventions = observed(left.interventions.length);
  const rightInterventions = observed(right.interventions.length);
  const leftFailures = failureSummary(left);
  const rightFailures = failureSummary(right);
  const unavailable = [];
  if (leftDuration.label === "unknown" || rightDuration.label === "unknown") unavailable.push("duration");
  unavailable.push("model-time", "estimate-accuracy", "cewp-overhead");
  for (const category of ["managedOperations", "capturedOutputBytes", "managedTokens", "hostInternal"]) {
    if (left.usage[category].label === "unknown" || right.usage[category].label === "unknown") unavailable.push(`usage.${category}`);
  }
  if (left.cost.apiEquivalent.label === "unknown" || right.cost.apiEquivalent.label === "unknown") unavailable.push("api-equivalent-cost");
  return {
    schemaVersion: RUN_COMPARISON_SCHEMA_VERSION,
    generatedAt: left.generatedAt === right.generatedAt ? left.generatedAt : null,
    runs: { left: summarizeRun(left), right: summarizeRun(right) },
    dimensions: {
      outcome: {
        left: { completeness: left.completeness.status, runStatus: left.completeness.runStatus, reviewerDecision: left.reviewer.decision },
        right: { completeness: right.completeness.status, runStatus: right.completeness.runStatus, reviewerDecision: right.reviewer.decision },
      },
      duration: { left: leftDuration, right: rightDuration, delta: delta(leftDuration, rightDuration) },
      modelTime: { left: unknown("effective model time is unavailable"), right: unknown("effective model time is unavailable") },
      usage: {
        managedOperations: { left: left.usage.managedOperations, right: right.usage.managedOperations },
        capturedOutputBytes: { left: left.usage.capturedOutputBytes, right: right.usage.capturedOutputBytes },
        managedTokens: { left: left.usage.managedTokens, right: right.usage.managedTokens },
        hostInternal: { left: left.usage.hostInternal, right: right.usage.hostInternal },
      },
      estimateAccuracy: { left: unknown("no calibrated observed outcome mapping"), right: unknown("no calibrated observed outcome mapping") },
      apiEquivalentCost: { left: left.cost.apiEquivalent, right: right.cost.apiEquivalent },
      cewpOverhead: { left: unknown("CEWP overhead was not separately observed"), right: unknown("CEWP overhead was not separately observed") },
      attempts: { left: leftAttempts, right: rightAttempts, delta: delta(leftAttempts, rightAttempts) },
      interventions: { left: leftInterventions, right: rightInterventions, delta: delta(leftInterventions, rightInterventions) },
      failures: { left: leftFailures, right: rightFailures, delta: observed(rightFailures.count - leftFailures.count, "derived-from-run-state") },
      scope: { left: scopeSummary(left), right: scopeSummary(right) },
      commands: { left: left.commands, right: right.commands },
      verification: { left: verificationSummary(left), right: verificationSummary(right) },
    },
    equivalence: {
      status: unavailable.length === 0 ? "complete" : "partial",
      unavailable: [...new Set(unavailable)].sort(),
      warning: unavailable.length > 0 ? "Unavailable values remain unknown and are excluded from numeric deltas." : null,
    },
  };
}

module.exports = {
  RUN_COMPARISON_SCHEMA_VERSION,
  compareEvidenceReceipts,
};
