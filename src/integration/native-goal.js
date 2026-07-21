"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateCodexCapabilitySnapshot } = require("./capabilities");
const { loadHostBinding } = require("./binding");
const { interveneWorkflow, loadWorkflowRun } = require("../workflow/state");

const NATIVE_GOAL_EVENT_SCHEMA_VERSION = "native-goal-event/v1";
const EVENT_TYPES = Object.freeze([
  "attached",
  "started",
  "checkpoint",
  "revised",
  "resumed",
  "stopped",
  "timed-out",
  "status",
  "partial-output",
  "malformed",
]);
const SOURCE_PATHS = Object.freeze(["plugin", "app-server", "explicit-intake"]);
const RAW_LIMIT_BYTES = 64 * 1024;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label, maximum = 1024) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid native goal event: ${label} is required.`);
  }
  const text = value.trim();
  if (text.length > maximum || /[\u0000-\u001f]/.test(text)) {
    throw new Error(`Invalid native goal event: ${label} is too long or contains control characters.`);
  }
  return text;
}

function optionalText(value, label, maximum = 1024) {
  return value === null ? null : requiredText(value, label, maximum);
}

function timestamp(value, label) {
  const text = requiredText(value, label, 128);
  if (!Number.isFinite(Date.parse(text))) {
    throw new Error(`Invalid native goal event: ${label} must be an ISO timestamp.`);
  }
  return new Date(text).toISOString();
}

function normalizeRaw(value) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error("Invalid native goal event: raw event must be JSON serializable.");
  }
  if (json === undefined || Buffer.byteLength(json, "utf8") > RAW_LIMIT_BYTES) {
    throw new Error(`Invalid native goal event: raw event exceeds ${RAW_LIMIT_BYTES} bytes.`);
  }
  return JSON.parse(json);
}

function normalizeSource(value) {
  if (!isObject(value)) throw new Error("Invalid native goal event: source is required.");
  const sourcePath = requiredText(value.path, "source.path", 64);
  if (!SOURCE_PATHS.includes(sourcePath)) {
    throw new Error(`Invalid native goal event: unsupported source path ${sourcePath}.`);
  }
  return {
    path: sourcePath,
    codexVersion: optionalText(value.codexVersion, "source.codexVersion", 256),
    nativeGoalSchemaVersion: optionalText(
      value.nativeGoalSchemaVersion,
      "source.nativeGoalSchemaVersion",
      256,
    ),
    capabilitySchemaVersion: optionalText(
      value.capabilitySchemaVersion,
      "source.capabilitySchemaVersion",
      256,
    ),
    authenticationBoundary: requiredText(
      value.authenticationBoundary,
      "source.authenticationBoundary",
      256,
    ),
  };
}

function normalizeWorkflow(value) {
  if (!isObject(value)) throw new Error("Invalid native goal event: workflow is required.");
  return {
    runId: requiredText(value.runId, "workflow.runId", 128),
    taskId: optionalText(value.taskId, "workflow.taskId", 64),
    checkpointId: optionalText(value.checkpointId, "workflow.checkpointId", 128),
  };
}

function normalizePartialOutput(value, type) {
  if (type !== "partial-output") {
    if (value !== null) throw new Error("Invalid native goal event: partialOutput is valid only for partial-output.");
    return null;
  }
  if (!isObject(value) || value.present !== true || value.complete !== false) {
    throw new Error("Invalid native goal event: partial output must be present and incomplete.");
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new Error("Invalid native goal event: partial output bytes must be a non-negative integer.");
  }
  return { present: true, bytes: value.bytes, complete: false };
}

function capabilityAssessment(source, options) {
  if (source.path === "explicit-intake") {
    return { available: true, compatibility: "explicit-intake", evidenceClass: "imported", snapshot: null };
  }
  if (!options.capabilities) {
    return { available: false, compatibility: "unavailable", evidenceClass: "unknown", snapshot: null };
  }
  const snapshot = validateCodexCapabilitySnapshot(options.capabilities);
  if (source.path === "plugin") {
    const observed = snapshot.surfaces.hostObservation;
    if (observed.status !== "supported" || observed.pluginPathCapabilityTestPassed !== true) {
      return { available: false, compatibility: "unavailable", evidenceClass: "unknown", snapshot };
    }
  } else if (
    snapshot.surfaces.appServer.status !== "supported"
    || snapshot.managedBackendDecision.appServerGraduated !== true
  ) {
    return { available: false, compatibility: "unavailable", evidenceClass: "unknown", snapshot };
  }
  const nativeGoal = snapshot.surfaces.nativeGoal;
  const exact = source.capabilitySchemaVersion === snapshot.schemaVersion
    && source.nativeGoalSchemaVersion === nativeGoal.schemaVersion;
  return {
    available: true,
    compatibility: exact ? "compatible" : "drifted",
    evidenceClass: "observed",
    snapshot,
  };
}

function statusMapping(status, capability) {
  const knownLimit = status === "budgetLimited" || status === "usageLimited";
  const nativeGoal = capability.snapshot && capability.snapshot.surfaces.nativeGoal;
  const versioned = capability.compatibility === "compatible"
    && nativeGoal
    && nativeGoal.statuses.includes(status);
  if (knownLimit && !versioned) {
    return { state: "paused-host-limit", limitKind: "unknown", versioned: false, success: false };
  }
  if (!versioned) return { state: "unknown", limitKind: null, versioned: false, success: false };
  if (status === "active") return { state: "active", limitKind: null, versioned: true, success: false };
  if (status === "paused") return { state: "interrupted", limitKind: null, versioned: true, success: false };
  if (status === "blocked") return { state: "blocked", limitKind: null, versioned: true, success: false };
  if (status === "budgetLimited") {
    return { state: "paused-host-limit", limitKind: "goal-budget", versioned: true, success: false };
  }
  if (status === "usageLimited") {
    return { state: "paused-host-limit", limitKind: "account-usage", versioned: true, success: false };
  }
  if (status === "complete") {
    return { state: "evidence-pending", limitKind: null, versioned: true, success: false };
  }
  return { state: "unknown", limitKind: null, versioned: true, success: false };
}

function mappingFor(type, status, capability) {
  if (type === "malformed") {
    return { state: "unknown", limitKind: null, versioned: false, success: false };
  }
  if (type === "partial-output") {
    return { state: "interrupted", limitKind: null, versioned: false, success: false };
  }
  if (type === "stopped") {
    return { state: "cancelled", limitKind: null, versioned: false, success: false };
  }
  if (type === "timed-out") {
    return { state: "timed-out", limitKind: null, versioned: false, success: false };
  }
  if (type === "checkpoint") {
    return { state: "evidence-pending", limitKind: null, versioned: false, success: false };
  }
  if (type === "revised") {
    return { state: "revision-pending", limitKind: null, versioned: false, success: false };
  }
  if (type === "attached") {
    return { state: "attached", limitKind: null, versioned: false, success: false };
  }
  return statusMapping(status, capability);
}

function normalizeNativeGoalEvent(value, options = {}) {
  if (!isObject(value) || value.schemaVersion !== NATIVE_GOAL_EVENT_SCHEMA_VERSION) {
    throw new Error(`Invalid native goal event: expected ${NATIVE_GOAL_EVENT_SCHEMA_VERSION}.`);
  }
  const eventId = requiredText(value.eventId, "eventId", 128);
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(eventId)) {
    throw new Error("Invalid native goal event: eventId must be a lowercase identifier.");
  }
  const type = requiredText(value.type, "type", 64);
  if (!EVENT_TYPES.includes(type)) throw new Error(`Invalid native goal event: unsupported type ${type}.`);
  const source = normalizeSource(value.source);
  const status = optionalText(value.status, "status", 64);
  if (["started", "resumed", "status"].includes(type) && !status) {
    throw new Error(`Invalid native goal event: ${type} requires status.`);
  }
  const capability = capabilityAssessment(source, options);
  const mapping = capability.available
    ? mappingFor(type, status, capability)
    : { state: "unknown", limitKind: null, versioned: false, success: false };
  const availability = type === "malformed"
    ? "malformed"
    : capability.available ? (capability.evidenceClass === "imported" ? "imported" : "observed") : "unavailable";
  return {
    schemaVersion: NATIVE_GOAL_EVENT_SCHEMA_VERSION,
    eventId,
    receivedAt: timestamp(value.receivedAt, "receivedAt"),
    source,
    workflow: normalizeWorkflow(value.workflow),
    goalId: requiredText(value.goalId, "goalId", 512),
    type,
    status,
    partialOutput: normalizePartialOutput(value.partialOutput, type),
    availability,
    evidenceClass: availability === "observed" ? "observed" : availability === "imported" ? "imported" : "unknown",
    compatibility: capability.compatibility,
    mapping,
    raw: normalizeRaw(value.raw),
  };
}

function eventLedgerPath(found) {
  return path.join(found.runRoot, "integration", "native-goal-events.jsonl");
}

function readNativeGoalEvents(found) {
  const filePath = eventLedgerPath(found);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new Error(`Invalid native goal event ledger line ${index + 1}.`);
      }
      if (!record.event || record.event.schemaVersion !== NATIVE_GOAL_EVENT_SCHEMA_VERSION) {
        throw new Error(`Invalid native goal event ledger schema at line ${index + 1}.`);
      }
      return record;
    });
}

function validateEventBinding(found, event) {
  if (event.workflow.runId !== found.run.runId) {
    throw new Error("Native goal event run id does not match the loaded workflow run.");
  }
  const task = event.workflow.taskId
    ? found.run.tasks.find((entry) => entry.id === event.workflow.taskId)
    : null;
  if (event.workflow.taskId && !task) throw new Error(`Native goal event task not found: ${event.workflow.taskId}.`);
  if (event.workflow.checkpointId && (!task || task.activeCheckpointId !== event.workflow.checkpointId)) {
    throw new Error("Native goal event checkpoint does not match the active CEWP checkpoint.");
  }
  const binding = loadHostBinding(found);
  if (!binding) throw new Error("Native goal event requires an existing host binding.");
  if (binding.references.goalId !== event.goalId) {
    throw new Error("Native goal event goal id does not match the host binding.");
  }
  if (event.source.path === "plugin" && binding.mode !== "attached") {
    throw new Error("Plugin-observed native goal events require an attached binding.");
  }
  if (event.source.path === "explicit-intake" && binding.mode !== "explicit-intake") {
    throw new Error("Explicit native goal events require an explicit-intake binding.");
  }
}

function applyEvent(found, event) {
  const application = {
    action: "none",
    canonicalStateChanged: false,
    successClaimed: false,
  };
  if (!["observed", "imported"].includes(event.availability)) return { application, run: found.run };
  const current = found.run.status;
  let interventionEvent = null;
  if (event.mapping.state === "paused-host-limit" && ["active", "review-pending"].includes(current)) {
    interventionEvent = "pause-host-limit";
  } else if (event.mapping.state === "interrupted" && ["active", "review-pending"].includes(current)) {
    interventionEvent = "interrupt";
  } else if (event.mapping.state === "active" && ["paused-host-limit", "interrupted", "timed-out"].includes(current)) {
    interventionEvent = "resume";
  } else if (event.mapping.state === "cancelled" && !["cancelled", "abandoned", "finalized"].includes(current)) {
    interventionEvent = "cancel";
  } else if (event.mapping.state === "timed-out" && ["active", "interrupted"].includes(current)) {
    interventionEvent = "timeout";
  }

  if (event.mapping.state === "revision-pending") application.action = "inspect-revision";
  if (event.mapping.state === "evidence-pending") application.action = "await-evidence";
  if (!interventionEvent) return { application, run: found.run };

  const result = interveneWorkflow(found, {
    event: interventionEvent,
    reason: `Native goal ${event.type}${event.status ? ` (${event.status})` : ""}.`,
    actor: event.evidenceClass === "observed" ? "host" : "operator-intake",
    source: event.source.path,
    now: new Date(event.receivedAt),
  });
  return {
    application: {
      action: interventionEvent,
      canonicalStateChanged: true,
      successClaimed: false,
    },
    run: result.run,
  };
}

function recordNativeGoalEvent(found, candidate, options = {}) {
  const current = loadWorkflowRun(found.repoRoot, found.run.runId);
  const event = normalizeNativeGoalEvent(candidate, options);
  validateEventBinding(current, event);
  const existing = readNativeGoalEvents(current);
  if (existing.some((entry) => entry.event.eventId === event.eventId)) {
    throw new Error(`Native goal event already exists: ${event.eventId}.`);
  }
  const applied = applyEvent(current, event);
  const record = { event, application: applied.application };
  const filePath = eventLedgerPath(current);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
  return { ...record, run: applied.run };
}

module.exports = {
  EVENT_TYPES,
  NATIVE_GOAL_EVENT_SCHEMA_VERSION,
  normalizeNativeGoalEvent,
  readNativeGoalEvents,
  recordNativeGoalEvent,
};
