"use strict";

const {
  normalizeEvidencePath,
  normalizeTruthValue,
} = require("./result");
const { validateFailureClassification } = require("./transitions");

const REVIEW_RESULT_SCHEMA_VERSION = "review-result/v1";
const REVIEW_DECISIONS = new Set(["PASS", "REQUEST_CHANGES", "BLOCK"]);
const FINDING_SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required.`);
  return value.trim();
}

function normalizeReviewScope(value, context) {
  if (!isObject(value) || !["workflow", "checkpoint"].includes(value.kind)) {
    throw new Error("Review result scope must be workflow or checkpoint.");
  }
  const scope = value.kind === "workflow"
    ? { kind: "workflow", taskId: null, checkpointId: null }
    : {
        kind: "checkpoint",
        taskId: requiredText(value.taskId, "scope.taskId"),
        checkpointId: requiredText(value.checkpointId, "scope.checkpointId"),
      };
  if (value.kind === "workflow" && (value.taskId !== null || value.checkpointId !== null)) {
    throw new Error("Workflow review scope requires null taskId and checkpointId.");
  }
  if (context.expectedScope && JSON.stringify(scope) !== JSON.stringify(context.expectedScope)) {
    throw new Error("Review result scope does not match the pending review gate.");
  }
  return scope;
}

function validateReviewResult(value, context) {
  if (!isObject(value) || value.schemaVersion !== REVIEW_RESULT_SCHEMA_VERSION) {
    throw new Error(`Review result must use ${REVIEW_RESULT_SCHEMA_VERSION}.`);
  }
  if (value.runId !== context.run.runId) throw new Error("Review result runId does not match the workflow run.");
  if (value.workflowDigest !== context.run.workflow.digest) {
    throw new Error("Review result workflowDigest does not match the approved workflow.");
  }
  const scope = normalizeReviewScope(value.scope, context);
  const reviewId = requiredText(value.reviewId, "reviewId");
  if (!/^[a-z0-9][a-z0-9-]{0,191}$/.test(reviewId)) {
    throw new Error("reviewId must use lowercase letters, digits, and hyphens.");
  }
  if (Number.isNaN(Date.parse(value.completedAt))) throw new Error("completedAt must be an ISO timestamp.");
  if (value.independent !== true) {
    throw new Error("Workflow finalization requires an independent reviewer result.");
  }
  const decision = requiredText(value.decision, "decision");
  if (!REVIEW_DECISIONS.has(decision)) throw new Error(`Unsupported review decision: ${decision}.`);
  const taskIds = new Set(context.run.tasks.map((task) => task.id));
  if (!Array.isArray(value.findings)) throw new Error("findings must be an array.");
  const findings = value.findings.map((finding, index) => {
    if (!isObject(finding)) throw new Error(`findings[${index}] must be an object.`);
    const severity = requiredText(finding.severity, `findings[${index}].severity`);
    if (!FINDING_SEVERITIES.has(severity)) {
      throw new Error(`findings[${index}].severity is unsupported: ${severity}.`);
    }
    const taskId = finding.taskId === null ? null : requiredText(finding.taskId, `findings[${index}].taskId`);
    if (taskId !== null && !taskIds.has(taskId)) throw new Error(`Review finding references unknown task: ${taskId}.`);
    const classification = finding.classification === null
      ? null
      : validateFailureClassification(finding.classification);
    if (!Array.isArray(finding.evidencePaths)) {
      throw new Error(`findings[${index}].evidencePaths must be an array.`);
    }
    return {
      taskId,
      classification,
      severity,
      summary: requiredText(finding.summary, `findings[${index}].summary`),
      evidencePaths: finding.evidencePaths.map((entry, evidenceIndex) => normalizeEvidencePath(
        entry,
        `findings[${index}].evidencePaths[${evidenceIndex}]`,
      )),
    };
  });
  if (decision !== "PASS" && findings.length === 0) {
    throw new Error(`${decision} requires at least one actionable finding.`);
  }
  if (decision !== "PASS" && findings.some((finding) => finding.taskId === null || finding.classification === null)) {
    throw new Error(`${decision} findings require a taskId and failure classification.`);
  }
  if (scope.kind === "checkpoint" && findings.some((finding) => finding.taskId !== scope.taskId)) {
    throw new Error("Checkpoint review findings must reference the scoped task.");
  }
  if (decision === "PASS" && findings.some((finding) => ["high", "critical"].includes(finding.severity))) {
    throw new Error("PASS cannot include unresolved high or critical findings.");
  }
  if (decision === "PASS" && findings.some((finding) => finding.classification !== null)) {
    throw new Error("PASS cannot include an unresolved failure classification.");
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new Error("Independent review requires at least one evidence link.");
  }
  const evidence = value.evidence.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`evidence[${index}] must be an object.`);
    return {
      kind: requiredText(entry.kind, `evidence[${index}].kind`),
      path: normalizeEvidencePath(entry.path, `evidence[${index}].path`),
    };
  });
  if (!isObject(value.usage)) throw new Error("Review result usage is required.");
  const managedOperations = normalizeTruthValue(
    value.usage.managedOperations,
    "usage.managedOperations",
    { requireSource: true },
  );
  if (managedOperations.label !== "observed" || managedOperations.value < 1) {
    throw new Error("Independent managed review requires a positive observed managed operation count.");
  }
  const capturedOutputBytes = normalizeTruthValue(
    value.usage.capturedOutputBytes,
    "usage.capturedOutputBytes",
    { requireSource: true },
  );
  if (capturedOutputBytes.label !== "observed") {
    throw new Error("Review usage.capturedOutputBytes must be observed for bounded result intake.");
  }
  return {
    schemaVersion: REVIEW_RESULT_SCHEMA_VERSION,
    reviewId,
    runId: value.runId,
    workflowDigest: value.workflowDigest,
    scope,
    completedAt: new Date(value.completedAt).toISOString(),
    independent: true,
    decision,
    summary: requiredText(value.summary, "summary"),
    findings,
    evidence,
    usage: {
      managedOperations,
      capturedOutputBytes,
      managedTokens: normalizeTruthValue(value.usage.managedTokens, "usage.managedTokens"),
      hostInternal: normalizeTruthValue(value.usage.hostInternal, "usage.hostInternal"),
    },
  };
}

module.exports = {
  REVIEW_RESULT_SCHEMA_VERSION,
  validateReviewResult,
};
