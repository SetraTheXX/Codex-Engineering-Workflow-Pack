"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { appendLifecycleEvent } = require("../evidence/events");
const { validateCodexCapabilitySnapshot } = require("./capabilities");

const HOST_OBSERVATION_SCHEMA_VERSION = "host-observation/v1";
const SOURCE_PATHS = Object.freeze([
  "codex-exec",
  "plugin",
  "app-server",
  "explicit-intake",
  "audit-import",
]);
const OBSERVATION_CATEGORIES = Object.freeze([
  "thread-usage",
  "rate-limit-window",
  "credits",
  "account-activity",
  "goal-budget",
  "goal-lifecycle",
]);
const AVAILABILITY = Object.freeze([
  "observed",
  "imported",
  "unknown",
  "unavailable",
  "stale",
  "malformed",
]);
const ACCOUNT_CATEGORIES = new Set(["rate-limit-window", "credits", "account-activity"]);
const WORKFLOW_CATEGORIES = new Set(["thread-usage", "goal-budget", "goal-lifecycle"]);
const RAW_LIMIT_BYTES = 64 * 1024;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label, maximum = 1024) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid host observation: ${label} is required.`);
  }
  const text = value.trim();
  if (text.length > maximum || /[\u0000-\u001f]/.test(text)) {
    throw new Error(`Invalid host observation: ${label} is too long or contains control characters.`);
  }
  return text;
}

function optionalText(value, label, maximum = 1024) {
  return value === null ? null : requiredText(value, label, maximum);
}

function timestamp(value, label) {
  const text = requiredText(value, label, 128);
  if (!Number.isFinite(Date.parse(text))) {
    throw new Error(`Invalid host observation: ${label} must be an ISO timestamp.`);
  }
  return new Date(text).toISOString();
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function finiteNumber(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function normalizeRaw(value) {
  if (value === undefined) return null;
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error("Invalid host observation: raw data must be JSON serializable.");
  }
  if (json === undefined || Buffer.byteLength(json, "utf8") > RAW_LIMIT_BYTES) {
    throw new Error(`Invalid host observation: raw data exceeds ${RAW_LIMIT_BYTES} bytes.`);
  }
  return JSON.parse(json);
}

function normalizeSource(value) {
  if (!isObject(value)) throw new Error("Invalid host observation: source is required.");
  const sourcePath = requiredText(value.path, "source.path", 64);
  if (!SOURCE_PATHS.includes(sourcePath)) {
    throw new Error(`Invalid host observation: unsupported source path ${sourcePath}.`);
  }
  return {
    path: sourcePath,
    codexVersion: optionalText(value.codexVersion, "source.codexVersion", 256),
    schemaVersion: requiredText(value.schemaVersion, "source.schemaVersion", 256),
    authenticationBoundary: requiredText(
      value.authenticationBoundary,
      "source.authenticationBoundary",
      256,
    ),
  };
}

function normalizeScope(value, category) {
  if (!isObject(value)) throw new Error("Invalid host observation: scope is required.");
  const kind = requiredText(value.kind, "scope.kind", 32);
  if (!["workflow-run", "account"].includes(kind)) {
    throw new Error(`Invalid host observation: unsupported scope kind ${kind}.`);
  }
  const scope = {
    kind,
    runId: optionalText(value.runId, "scope.runId", 128),
    taskId: optionalText(value.taskId, "scope.taskId", 64),
    checkpointId: optionalText(value.checkpointId, "scope.checkpointId", 128),
  };
  if (kind === "workflow-run") {
    if (!scope.runId) throw new Error("Invalid host observation: workflow-run scope requires runId.");
    if (!WORKFLOW_CATEGORIES.has(category)) {
      throw new Error(`Invalid host observation: ${category} is account-scoped, not per-run usage.`);
    }
  } else {
    if (scope.runId || scope.taskId || scope.checkpointId) {
      throw new Error("Invalid host observation: account scope cannot claim workflow attribution.");
    }
    if (!ACCOUNT_CATEGORIES.has(category)) {
      throw new Error(`Invalid host observation: ${category} requires workflow-run scope.`);
    }
  }
  return scope;
}

function normalizeThreadUsage(value) {
  if (!isObject(value)) throw new Error("thread usage data must be an object.");
  const data = {
    inputTokens: nonNegativeInteger(value.inputTokens, "inputTokens"),
    cachedInputTokens: nonNegativeInteger(value.cachedInputTokens, "cachedInputTokens"),
    outputTokens: nonNegativeInteger(value.outputTokens, "outputTokens"),
    reasoningOutputTokens: nonNegativeInteger(value.reasoningOutputTokens, "reasoningOutputTokens"),
  };
  if (data.cachedInputTokens > data.inputTokens) {
    throw new Error("cachedInputTokens cannot exceed inputTokens.");
  }
  return data;
}

function normalizeRateLimit(value) {
  if (!isObject(value)) throw new Error("rate-limit data must be an object.");
  return {
    window: requiredText(value.window, "window", 128),
    usedPercent: finiteNumber(value.usedPercent, "usedPercent", 0, 100),
    resetAt: timestamp(value.resetAt, "resetAt"),
  };
}

function normalizeCredits(value) {
  if (!isObject(value)) throw new Error("credit data must be an object.");
  return {
    remaining: finiteNumber(value.remaining, "remaining"),
    unit: requiredText(value.unit, "unit", 64),
    resetAt: value.resetAt === null ? null : timestamp(value.resetAt, "resetAt"),
  };
}

function normalizeAccountActivity(value) {
  if (!isObject(value)) throw new Error("account activity data must be an object.");
  const windowStart = timestamp(value.windowStart, "windowStart");
  const windowEnd = timestamp(value.windowEnd, "windowEnd");
  if (Date.parse(windowEnd) < Date.parse(windowStart)) {
    throw new Error("account activity windowEnd must not precede windowStart.");
  }
  return {
    windowStart,
    windowEnd,
    amount: finiteNumber(value.amount, "amount"),
    unit: requiredText(value.unit, "unit", 64),
  };
}

function normalizeGoalBudget(value) {
  if (!isObject(value)) throw new Error("goal budget data must be an object.");
  return {
    status: requiredText(value.status, "status", 64),
    tokenBudget: value.tokenBudget === null ? null : nonNegativeInteger(value.tokenBudget, "tokenBudget"),
    tokensUsed: value.tokensUsed === null ? null : nonNegativeInteger(value.tokensUsed, "tokensUsed"),
  };
}

function normalizeGoalLifecycle(value) {
  if (!isObject(value)) throw new Error("goal lifecycle data must be an object.");
  return {
    status: requiredText(value.status, "status", 64),
    event: requiredText(value.event, "event", 128),
  };
}

function normalizeData(category, value) {
  if (category === "thread-usage") return normalizeThreadUsage(value);
  if (category === "rate-limit-window") return normalizeRateLimit(value);
  if (category === "credits") return normalizeCredits(value);
  if (category === "account-activity") return normalizeAccountActivity(value);
  if (category === "goal-budget") return normalizeGoalBudget(value);
  return normalizeGoalLifecycle(value);
}

function sourceCapability(source, category, capabilities) {
  if (source.path === "codex-exec") {
    return category === "thread-usage" && source.schemaVersion === "codex-exec-jsonl/v1"
      ? { available: true }
      : { available: false, reason: "codex-exec-source-category-not-supported" };
  }
  if (["explicit-intake", "audit-import"].includes(source.path)) {
    return { available: true, imported: true };
  }
  if (!capabilities) return { available: false, reason: "versioned-capability-snapshot-missing" };
  const snapshot = validateCodexCapabilitySnapshot(capabilities);
  if (source.path === "plugin") {
    const surface = snapshot.surfaces.hostObservation;
    return surface.status === "supported" && surface.pluginPathCapabilityTestPassed === true
      ? { available: true }
      : { available: false, reason: "plugin-path-capability-not-proved" };
  }
  const appServer = snapshot.surfaces.appServer;
  return appServer.status === "supported"
    && snapshot.managedBackendDecision.appServerGraduated === true
    && appServer.observationCapabilityTestPassed === true
    ? { available: true }
    : { available: false, reason: "app-server-observation-capability-not-proved" };
}

function normalizeHostObservation(value, options = {}) {
  if (!isObject(value) || value.schemaVersion !== HOST_OBSERVATION_SCHEMA_VERSION) {
    throw new Error(`Invalid host observation: expected ${HOST_OBSERVATION_SCHEMA_VERSION}.`);
  }
  const observationId = requiredText(value.observationId, "observationId", 128);
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(observationId)) {
    throw new Error("Invalid host observation: observationId must be a lowercase identifier.");
  }
  const observedAt = timestamp(value.observedAt, "observedAt");
  const source = normalizeSource(value.source);
  const category = requiredText(value.category, "category", 64);
  if (!OBSERVATION_CATEGORIES.includes(category)) {
    throw new Error(`Invalid host observation: unsupported category ${category}.`);
  }
  const scope = normalizeScope(value.scope, category);
  const rawCategory = requiredText(value.rawCategory, "rawCategory", 256);
  const raw = normalizeRaw(value.raw);
  let availability = requiredText(value.availability, "availability", 32);
  if (!AVAILABILITY.includes(availability)) {
    throw new Error(`Invalid host observation: unsupported availability ${availability}.`);
  }
  const capability = sourceCapability(source, category, options.capabilities);
  let reason = value.reason === undefined || value.reason === null
    ? null
    : requiredText(value.reason, "reason", 512);
  let data = null;

  if (["observed", "imported"].includes(availability)) {
    if (!capability.available) {
      availability = "unavailable";
      reason = capability.reason;
    } else if (capability.imported && availability !== "imported") {
      availability = "malformed";
      reason = "imported-source-cannot-claim-observed";
    } else if (!capability.imported && availability === "imported") {
      availability = "malformed";
      reason = "managed-or-plugin-source-cannot-claim-imported";
    } else {
      try {
        data = normalizeData(category, value.data);
      } catch (error) {
        availability = "malformed";
        reason = error.message;
      }
    }
  } else if (!reason) {
    reason = `${availability}-host-observation`;
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs >= 0
    ? options.maxAgeMs
    : null;
  if (
    data
    && maxAgeMs !== null
    && Date.parse(observedAt) < now.getTime() - maxAgeMs
    && ["rate-limit-window", "credits", "goal-budget"].includes(category)
  ) {
    availability = "stale";
    reason = "observation-exceeded-freshness-window";
    data = null;
  }

  const evidenceClass = availability === "observed"
    ? "observed"
    : availability === "imported" ? "imported" : "unknown";
  if (!["observed", "imported"].includes(availability)) data = null;

  return {
    schemaVersion: HOST_OBSERVATION_SCHEMA_VERSION,
    observationId,
    observedAt,
    source,
    scope,
    category,
    rawCategory,
    availability,
    evidenceClass,
    reason,
    data,
    raw,
    billingImpact: "unknown",
  };
}

function ledgerPath(found) {
  return path.join(found.runRoot, "integration", "host-observations.jsonl");
}

function readHostObservations(found) {
  const filePath = ledgerPath(found);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      let observation;
      try {
        observation = JSON.parse(line);
      } catch {
        throw new Error(`Invalid host observation ledger line ${index + 1}.`);
      }
      if (observation.schemaVersion !== HOST_OBSERVATION_SCHEMA_VERSION) {
        throw new Error(`Invalid host observation ledger schema at line ${index + 1}.`);
      }
      return observation;
    });
}

function recordHostObservation(found, candidate, options = {}) {
  const observation = normalizeHostObservation(candidate, options);
  if (observation.scope.kind === "workflow-run" && observation.scope.runId !== found.run.runId) {
    throw new Error("Host observation run id does not match the loaded workflow run.");
  }
  const existing = readHostObservations(found);
  if (existing.some((entry) => entry.observationId === observation.observationId)) {
    throw new Error(`Host observation already exists: ${observation.observationId}.`);
  }
  const filePath = ledgerPath(found);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(observation)}\n`);
  appendLifecycleEvent(found.runRoot, {
    timestamp: observation.observedAt,
    type: "usage-observed",
    runId: found.run.runId,
    observationId: observation.observationId,
    usageCategory: observation.category,
    availability: observation.availability,
    evidenceClass: observation.evidenceClass,
    actor: observation.source.path,
  });
  return observation;
}

module.exports = {
  AVAILABILITY,
  HOST_OBSERVATION_SCHEMA_VERSION,
  OBSERVATION_CATEGORIES,
  SOURCE_PATHS,
  normalizeHostObservation,
  readHostObservations,
  recordHostObservation,
};
