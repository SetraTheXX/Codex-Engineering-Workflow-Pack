"use strict";

const { normalizeSlashPath } = require("../lib/paths");
const {
  normalizeFailureSignature,
  validateFailureClassification,
} = require("./transitions");

const TASK_RESULT_SCHEMA_VERSION = "task-result/v1";
const VERIFICATION_STATUSES = new Set([
  "passed", "failed", "flaky", "invalid-test", "environment-failure", "timed-out",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required.`);
  return value.trim();
}

function normalizeEvidencePath(value, label) {
  const normalized = normalizeSlashPath(requiredText(value, label)).replace(/^\.\//, "");
  if (
    normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("/../")
    || normalized.startsWith("/")
    || /^[a-zA-Z]:\//.test(normalized)
    || normalized === ".git"
    || normalized.startsWith(".git/")
  ) {
    throw new Error(`${label} must be a safe repository-relative path.`);
  }
  return normalized;
}

function scopeRoot(scope) {
  return normalizeSlashPath(scope).replace(/\/(?:\*\*|\*)$/, "").replace(/\/$/, "").toLowerCase();
}

function pathMatchesScope(filePath, scope) {
  const file = normalizeSlashPath(filePath).toLowerCase();
  const root = scopeRoot(scope);
  return file === root || file.startsWith(`${root}/`);
}

function normalizeVerificationEntries(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`${label}[${index}] must be an object.`);
    const status = requiredText(entry.status, `${label}[${index}].status`);
    if (!VERIFICATION_STATUSES.has(status)) {
      throw new Error(`${label}[${index}].status is unsupported: ${status}.`);
    }
    return {
      command: requiredText(entry.command, `${label}[${index}].command`),
      status,
      evidencePath: normalizeEvidencePath(entry.evidencePath, `${label}[${index}].evidencePath`),
    };
  });
}

function indexApprovedEvidence(schedule, entries, label) {
  const byCommand = new Map();
  for (const entry of entries) {
    if (byCommand.has(entry.command)) throw new Error(`Duplicate ${label} verification evidence: ${entry.command}.`);
    byCommand.set(entry.command, entry);
  }
  const unexpected = [...byCommand.keys()].filter((command) => !schedule.includes(command));
  if (unexpected.length > 0) throw new Error(`Task result contains unapproved ${label} verification: ${unexpected[0]}.`);
  return byCommand;
}

function assertScheduledEvidence(schedule, entries, label) {
  const byCommand = new Map();
  for (const entry of entries) {
    if (byCommand.has(entry.command)) throw new Error(`Duplicate ${label} verification evidence: ${entry.command}.`);
    byCommand.set(entry.command, entry);
  }
  for (const command of schedule) {
    if (!byCommand.has(command)) throw new Error(`Task result is missing ${label} verification evidence for: ${command}.`);
    if (byCommand.get(command).status !== "passed") {
      throw new Error(`Task result ${label} verification did not pass: ${command}.`);
    }
  }
  const unexpected = [...byCommand.keys()].filter((command) => !schedule.includes(command));
  if (unexpected.length > 0) throw new Error(`Task result contains unapproved ${label} verification: ${unexpected[0]}.`);
}

function normalizeTruthValue(value, label, options = {}) {
  if (!isObject(value) || !["observed", "estimated", "budgeted", "unknown"].includes(value.label)) {
    throw new Error(`${label} requires an observed, estimated, budgeted, or unknown truth label.`);
  }
  if (value.label === "unknown") {
    if (value.value !== null) throw new Error(`${label} unknown value must be null.`);
    return { label: "unknown", value: null, reason: requiredText(value.reason, `${label}.reason`) };
  }
  if (!Number.isInteger(value.value) || value.value < 0) throw new Error(`${label}.value must be a non-negative integer.`);
  const normalized = { label: value.label, value: value.value };
  if (options.requireSource) normalized.source = requiredText(value.source, `${label}.source`);
  return normalized;
}

function validateTaskResult(value, context) {
  if (!isObject(value) || value.schemaVersion !== TASK_RESULT_SCHEMA_VERSION) {
    throw new Error(`Task result must use ${TASK_RESULT_SCHEMA_VERSION}.`);
  }
  for (const [field, expected] of [
    ["runId", context.run.runId],
    ["taskId", context.task.id],
    ["checkpointId", context.checkpoint.checkpointId],
  ]) {
    if (value[field] !== expected) throw new Error(`Task result ${field} does not match the active checkpoint.`);
  }
  const resultId = requiredText(value.resultId, "resultId");
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(resultId)) throw new Error("resultId must use lowercase letters, digits, and hyphens.");
  const outcome = requiredText(value.outcome, "outcome");
  if (!["succeeded", "failed"].includes(outcome)) {
    throw new Error("Task result outcome must be succeeded or failed.");
  }
  if (Number.isNaN(Date.parse(value.completedAt))) throw new Error("completedAt must be an ISO timestamp.");
  if (!Array.isArray(value.changedFiles)) throw new Error("changedFiles must be an array.");
  const changedFiles = value.changedFiles.map((entry, index) => normalizeEvidencePath(entry, `changedFiles[${index}]`));
  if (new Set(changedFiles).size !== changedFiles.length) throw new Error("changedFiles must not contain duplicates.");
  for (const changedFile of changedFiles) {
    if (!context.definitionTask.allowedFiles.some((scope) => pathMatchesScope(changedFile, scope))) {
      throw new Error(`Task result changed file outside approved scope: ${changedFile}.`);
    }
    if (context.definitionTask.forbiddenFiles.some((scope) => pathMatchesScope(changedFile, scope))) {
      throw new Error(`Task result changed forbidden file: ${changedFile}.`);
    }
  }
  if (!isObject(value.verification) || !isObject(value.verification.baseline)) {
    throw new Error("Task result verification baseline is required.");
  }
  const baselineStatus = requiredText(value.verification.baseline.status, "verification.baseline.status");
  if (!VERIFICATION_STATUSES.has(baselineStatus)) {
    throw new Error(`verification.baseline.status is unsupported: ${baselineStatus}.`);
  }
  const baselineEvidence = normalizeVerificationEntries(
    value.verification.baseline.evidence,
    "verification.baseline.evidence",
  );
  const targeted = normalizeVerificationEntries(value.verification.targeted, "verification.targeted");
  const full = normalizeVerificationEntries(value.verification.full, "verification.full");
  if (outcome === "succeeded") {
    if (baselineStatus !== "passed") {
      throw new Error("Task result baseline must pass before a success result can advance.");
    }
    if (baselineEvidence.length === 0 || baselineEvidence.some((entry) => entry.status !== "passed")) {
      throw new Error("Task result baseline requires passing evidence.");
    }
    assertScheduledEvidence(context.definitionTask.verification.targeted, baselineEvidence, "baseline");
    assertScheduledEvidence(context.definitionTask.verification.targeted, targeted, "targeted");
    assertScheduledEvidence(context.definitionTask.verification.full, full, "full");
  } else {
    indexApprovedEvidence(context.definitionTask.verification.targeted, baselineEvidence, "baseline");
    indexApprovedEvidence(context.definitionTask.verification.targeted, targeted, "targeted");
    indexApprovedEvidence(context.definitionTask.verification.full, full, "full");
  }
  if (!isObject(value.usage)) throw new Error("Task result usage is required.");
  const usage = {
    managedOperations: normalizeTruthValue(value.usage.managedOperations, "usage.managedOperations", { requireSource: true }),
    capturedOutputBytes: normalizeTruthValue(
      value.usage.capturedOutputBytes,
      "usage.capturedOutputBytes",
      { requireSource: true },
    ),
    managedTokens: normalizeTruthValue(value.usage.managedTokens, "usage.managedTokens"),
    hostInternal: normalizeTruthValue(value.usage.hostInternal, "usage.hostInternal"),
  };
  if (usage.capturedOutputBytes.label !== "observed") {
    throw new Error("usage.capturedOutputBytes must be observed for bounded result intake.");
  }
  if (
    context.run.execution.owner === "managed"
    && (usage.managedOperations.label !== "observed" || usage.managedOperations.value < 1)
  ) {
    throw new Error("Managed task result requires a positive observed managed operation count.");
  }
  if (!Array.isArray(value.artifacts)) throw new Error("artifacts must be an array.");
  const artifacts = value.artifacts.map((artifact, index) => {
    if (!isObject(artifact)) throw new Error(`artifacts[${index}] must be an object.`);
    return {
      kind: requiredText(artifact.kind, `artifacts[${index}].kind`),
      path: normalizeEvidencePath(artifact.path, `artifacts[${index}].path`),
    };
  });
  let failure = null;
  if (outcome === "succeeded") {
    if (value.failure !== null) throw new Error("A succeeded task result must have a null failure.");
  } else {
    if (!isObject(value.failure)) throw new Error("A failed task result requires failure details.");
    const classification = validateFailureClassification(value.failure.classification);
    if (classification === "repeated-failure") {
      throw new Error("repeated-failure is derived from canonical failure history and cannot be submitted.");
    }
    if (!Array.isArray(value.failure.evidencePaths) || value.failure.evidencePaths.length === 0) {
      throw new Error("A failed task result requires at least one failure evidence path.");
    }
    failure = {
      classification,
      signature: normalizeFailureSignature(value.failure.signature),
      summary: requiredText(value.failure.summary, "failure.summary"),
      evidencePaths: value.failure.evidencePaths.map((entry, index) => normalizeEvidencePath(
        entry,
        `failure.evidencePaths[${index}]`,
      )),
    };
  }
  return {
    schemaVersion: TASK_RESULT_SCHEMA_VERSION,
    resultId,
    runId: value.runId,
    taskId: value.taskId,
    checkpointId: value.checkpointId,
    outcome,
    completedAt: new Date(value.completedAt).toISOString(),
    changedFiles,
    verification: {
      baseline: { status: baselineStatus, evidence: baselineEvidence },
      targeted,
      full,
    },
    usage,
    artifacts,
    failure,
  };
}

module.exports = {
  TASK_RESULT_SCHEMA_VERSION,
  normalizeEvidencePath,
  normalizeTruthValue,
  pathMatchesScope,
  validateTaskResult,
};
