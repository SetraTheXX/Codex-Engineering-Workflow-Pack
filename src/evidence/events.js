"use strict";

const fs = require("node:fs");

const EVENT_SCHEMA_VERSION = "event/v1";
const LEGACY_EVENT_SCHEMA_VERSIONS = new Set(["workflow-event/v1"]);
const EVENT_CATEGORIES = Object.freeze({
  "workflow-approved": "run",
  "workflow-migrated": "plan-revision",
  "workflow-revised": "plan-revision",
  "task-started": "task",
  "task-failed": "task",
  "task-completed": "task",
  "checkpoint-started": "checkpoint",
  "checkpoint-completed": "checkpoint",
  "dispatch-started": "dispatch",
  "dispatch-completed": "dispatch",
  "workflow-intervention": "operator-intervention",
  "verification-completed": "verification",
  "usage-observed": "usage-observation",
  "estimate-revised": "estimate-revision",
  "budget-approved": "budget-approval",
  "allocation-consumed": "allocation-consumption",
  "budget-threshold": "threshold",
  "warning-presented": "warning-presentation",
  "pause-budget-safe": "safe-pause",
  "paused-budget-safe": "safe-pause",
  "pause-budget-unverified": "unverified-pause",
  "paused-budget-unverified": "unverified-pause",
  "pause-host-limit": "host-limit",
  "paused-host-limit": "host-limit",
  "scope-evaluated": "scope",
  "review-passed": "review",
  "review-blocked": "review",
  "checkpoint-review-passed": "review",
  "checkpoint-review-blocked": "review",
  "workflow-cancelled": "cancellation",
  "workflow-finalized": "finalize",
  "workflow-lifecycle": "run",
  "hook-evidence-approved": "scope",
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLifecycleEvent(candidate, options = {}) {
  if (!isObject(candidate)) throw new Error("Lifecycle event must be an object.");
  const legacy = LEGACY_EVENT_SCHEMA_VERSIONS.has(candidate.schemaVersion);
  if (candidate.schemaVersion !== EVENT_SCHEMA_VERSION && !(options.allowLegacy && legacy)) {
    throw new Error(`Incompatible lifecycle event schema: ${candidate.schemaVersion || "missing"}.`);
  }
  if (typeof candidate.type !== "string" || !EVENT_CATEGORIES[candidate.type]) {
    throw new Error(`Unknown lifecycle event type: ${candidate.type || "missing"}.`);
  }
  if (typeof candidate.runId !== "string" || candidate.runId.length === 0) {
    throw new Error("Lifecycle event runId is required.");
  }
  if (options.runId && candidate.runId !== options.runId) {
    throw new Error(`Lifecycle event runId mismatch: ${candidate.runId}.`);
  }
  if (typeof candidate.timestamp !== "string" || !Number.isFinite(Date.parse(candidate.timestamp))) {
    throw new Error("Lifecycle event timestamp must be an ISO timestamp.");
  }
  const category = EVENT_CATEGORIES[candidate.type];
  if (!legacy && candidate.category !== category) {
    throw new Error(`Lifecycle event ${candidate.type} requires category ${category}.`);
  }
  return {
    ...candidate,
    schemaVersion: EVENT_SCHEMA_VERSION,
    timestamp: new Date(candidate.timestamp).toISOString(),
    category,
  };
}

function createLifecycleEvent(candidate) {
  return normalizeLifecycleEvent({
    ...candidate,
    schemaVersion: EVENT_SCHEMA_VERSION,
    category: EVENT_CATEGORIES[candidate.type],
  });
}

function parseLifecycleEvents(content, options = {}) {
  const events = [];
  const issues = [];
  String(content).split(/\r?\n/).forEach((line, index) => {
    if (!line) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      issues.push({ code: "malformed-event", line: index + 1, message: "Lifecycle event is not valid JSON." });
      return;
    }
    try {
      events.push(normalizeLifecycleEvent(parsed, { ...options, allowLegacy: true }));
    } catch (error) {
      issues.push({
        code: /schema/.test(error.message) ? "incompatible-event-schema" : "invalid-event",
        line: index + 1,
        message: error.message,
      });
    }
  });
  return { events, issues };
}

function readLifecycleEvents(filePath, options = {}) {
  const parsed = parseLifecycleEvents(fs.readFileSync(filePath, "utf8"), options);
  if (parsed.issues.length > 0) {
    const first = parsed.issues[0];
    throw new Error(`${first.code} at line ${first.line}: ${first.message}`);
  }
  return parsed.events;
}

function appendLifecycleEvent(runRoot, candidate) {
  const event = createLifecycleEvent(candidate);
  fs.appendFileSync(require("node:path").join(runRoot, "events.jsonl"), `${JSON.stringify(event)}\n`);
  return event;
}

module.exports = {
  EVENT_CATEGORIES,
  EVENT_SCHEMA_VERSION,
  appendLifecycleEvent,
  createLifecycleEvent,
  normalizeLifecycleEvent,
  parseLifecycleEvents,
  readLifecycleEvents,
};
