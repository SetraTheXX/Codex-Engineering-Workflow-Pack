"use strict";

const { readHostObservations } = require("../integration/observation");

const USAGE_OBSERVATION_SCHEMA_VERSION = "usage-observation/v1";
const USAGE_ESTIMATE_SCHEMA_VERSION = "usage-estimate/v1";
const RESULT_CATEGORIES = Object.freeze([
  "managedOperations",
  "capturedOutputBytes",
  "managedTokens",
  "hostInternal",
]);

function sourceBoundary(source) {
  if (typeof source !== "string") return "unknown";
  if (source.startsWith("codex-exec")) return "managed-child-process";
  if (source.startsWith("cewp-")) return "cewp-core-local";
  return "unknown";
}

function resultObservations(kind, values) {
  return values.flatMap((value) => RESULT_CATEGORIES.map((category) => {
    const truth = value.usage[category];
    const sourceId = truth.source || `${kind}-contract`;
    return {
      schemaVersion: USAGE_OBSERVATION_SCHEMA_VERSION,
      observationId: `${kind}:${kind === "task-result" ? value.resultId : value.reviewId}:${category}`,
      observedAt: value.completedAt,
      scope: {
        runId: value.runId,
        taskId: value.taskId || (value.scope && value.scope.taskId) || null,
        checkpointId: value.checkpointId || (value.scope && value.scope.checkpointId) || null,
      },
      category,
      rawCategory: `usage.${category}`,
      availability: truth.label === "observed" ? "observed" : "unknown",
      evidenceClass: truth.label === "observed" ? "observed" : "unknown",
      value: truth.value,
      reason: truth.reason || null,
      source: {
        kind,
        id: sourceId,
        schemaVersion: value.schemaVersion,
        authenticationBoundary: sourceBoundary(truth.source),
      },
      effectiveModel: { status: "unknown", value: null, reason: "result contract does not expose effective model" },
      rawValue: truth,
    };
  }));
}

function hostObservations(found, warnings) {
  let entries;
  try {
    entries = readHostObservations(found);
  } catch (error) {
    warnings.push({ code: "malformed-usage-observation-ledger", message: error.message });
    return [];
  }
  return entries.map((entry) => ({
    schemaVersion: USAGE_OBSERVATION_SCHEMA_VERSION,
    observationId: `host:${entry.observationId}`,
    observedAt: entry.observedAt,
    scope: {
      runId: entry.scope.runId,
      taskId: entry.scope.taskId,
      checkpointId: entry.scope.checkpointId,
    },
    category: entry.category,
    rawCategory: entry.rawCategory,
    availability: entry.availability,
    evidenceClass: entry.evidenceClass,
    value: entry.data,
    reason: entry.reason,
    source: {
      kind: "host-observation",
      id: entry.source.path,
      schemaVersion: entry.source.schemaVersion,
      codexVersion: entry.source.codexVersion,
      authenticationBoundary: entry.source.authenticationBoundary,
    },
    effectiveModel: { status: "unknown", value: null, reason: "host observation does not expose effective model" },
    rawValue: null,
    billingImpact: entry.billingImpact,
  }));
}

function buildUsageObservations(found, results, reviews, warnings = []) {
  return [
    ...resultObservations("task-result", results),
    ...resultObservations("review-result", reviews),
    ...hostObservations(found, warnings),
  ].sort((left, right) => left.observationId < right.observationId ? -1 : left.observationId > right.observationId ? 1 : 0);
}

function unknownUsageEstimate(reason = "At least five comparable local runs with known model and effort are required.") {
  return {
    schemaVersion: USAGE_ESTIMATE_SCHEMA_VERSION,
    label: "unknown",
    range: null,
    confidence: "unavailable",
    estimator: {
      version: "local-history/v1",
      method: "comparable-run-interval",
      minimumSampleCount: 5,
      groupingDimensions: [
        "taskClass", "effectiveModel", "effectiveEffort", "assurance", "repositorySizeBucket",
        "checkpointCount", "workerReviewerShape", "repairs", "verificationSchedule",
      ],
    },
    sampleBasis: {
      count: 0,
      comparableRunIds: [],
      localOnly: true,
      promptsStored: false,
      sourceStored: false,
      rawLogsStored: false,
    },
    calibrationSnapshot: {
      id: null,
      createdAt: null,
      intervalCoverage: null,
      absoluteError: null,
    },
    drift: {
      state: "unknown",
      checkedAt: null,
      changedDimensions: [],
    },
    reason,
  };
}

module.exports = {
  USAGE_ESTIMATE_SCHEMA_VERSION,
  USAGE_OBSERVATION_SCHEMA_VERSION,
  buildUsageObservations,
  unknownUsageEstimate,
};
