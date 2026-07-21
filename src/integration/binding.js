"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CODEX_INTEGRATION_CAPABILITIES_SCHEMA_VERSION,
  selectManagedBackend,
  validateCodexCapabilitySnapshot,
} = require("./capabilities");
const { writeJsonAtomic } = require("../workflow/state");

const HOST_BINDING_SCHEMA_VERSION = "host-binding/v1";
const GENERATED_GOAL_BRIEF_SCHEMA_VERSION = "generated-goal-brief/v1";
const HOST_SURFACES = Object.freeze([
  "chatgpt-desktop",
  "codex-cli",
  "ide",
  "app-server",
  "external-client",
]);
const BINDING_MODES = Object.freeze([
  "explicit-intake",
  "attached",
  "managed-backend",
  "audit-import",
]);
const PROVENANCE_MODES = Object.freeze({
  "explicit-intake": "explicit-intake",
  "plugin-observed": "attached",
  "managed-backend": "managed-backend",
  "imported-audit": "audit-import",
});
const CONTROL_CLASSES = Object.freeze([
  "preventive",
  "postExecution",
  "imported",
  "unavailable",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label, maximum = 1024) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid host binding: ${label} is required.`);
  }
  const text = value.trim();
  if (text.length > maximum || /[\u0000-\u001f]/.test(text)) {
    throw new Error(`Invalid host binding: ${label} is too long or contains control characters.`);
  }
  return text;
}

function optionalText(value, label, maximum) {
  return value === null ? null : requiredText(value, label, maximum);
}

function normalizeTimestamp(value, label) {
  const timestamp = requiredText(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Invalid host binding: ${label} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeStringList(value, label) {
  if (!Array.isArray(value)) throw new Error(`Invalid host binding: ${label} must be an array.`);
  const entries = value.map((entry, index) => requiredText(entry, `${label}[${index}]`, 128));
  if (new Set(entries).size !== entries.length) {
    throw new Error(`Invalid host binding: ${label} must not contain duplicates.`);
  }
  return entries;
}

function normalizeExecution(value) {
  if (!isObject(value)) throw new Error("Invalid host binding: execution is required.");
  const owner = requiredText(value.owner, "execution.owner", 32);
  if (!["managed", "native", "audit-only"].includes(owner)) {
    throw new Error(`Invalid host binding: unsupported execution owner ${owner}.`);
  }
  const backend = value.backend === null ? null : requiredText(value.backend, "execution.backend", 64);
  if (owner === "managed" && !["codex-exec", "app-server"].includes(backend)) {
    throw new Error("Invalid host binding: managed execution requires codex-exec or app-server.");
  }
  if (owner !== "managed" && backend !== null) {
    throw new Error(`Invalid host binding: ${owner} execution cannot claim a managed backend.`);
  }
  return { owner, backend };
}

function normalizeSubagents(value) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("Invalid host binding: references.subagents must contain at most 32 entries.");
  }
  const subagents = value.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`Invalid host binding: references.subagents[${index}] is invalid.`);
    return {
      id: requiredText(entry.id, `references.subagents[${index}].id`, 512),
      threadId: optionalText(entry.threadId, `references.subagents[${index}].threadId`, 512),
      summary: optionalText(entry.summary, `references.subagents[${index}].summary`, 4000),
    };
  });
  if (new Set(subagents.map((entry) => entry.id)).size !== subagents.length) {
    throw new Error("Invalid host binding: subagent ids must be unique.");
  }
  return subagents;
}

function normalizeWorktree(value) {
  if (value === null) return null;
  if (!isObject(value)) throw new Error("Invalid host binding: references.worktree must be an object or null.");
  return {
    id: requiredText(value.id, "references.worktree.id", 512),
    path: requiredText(value.path, "references.worktree.path", 4096),
  };
}

function validateHostBinding(value, found) {
  if (!isObject(value) || value.schemaVersion !== HOST_BINDING_SCHEMA_VERSION) {
    throw new Error(`Invalid host binding: expected ${HOST_BINDING_SCHEMA_VERSION}.`);
  }
  if (!isObject(value.workflow)) throw new Error("Invalid host binding: workflow is required.");
  const workflow = {
    runId: requiredText(value.workflow.runId, "workflow.runId", 128),
    taskId: optionalText(value.workflow.taskId, "workflow.taskId", 64),
    checkpointId: optionalText(value.workflow.checkpointId, "workflow.checkpointId", 128),
  };
  if (found) {
    if (workflow.runId !== found.run.runId) {
      throw new Error("Invalid host binding: workflow run id does not match the loaded run.");
    }
    const runtimeTask = workflow.taskId
      ? found.run.tasks.find((task) => task.id === workflow.taskId)
      : null;
    if (workflow.taskId && !runtimeTask) {
      throw new Error(`Invalid host binding: workflow task not found: ${workflow.taskId}.`);
    }
    if (workflow.checkpointId && (!runtimeTask || runtimeTask.activeCheckpointId !== workflow.checkpointId)) {
      throw new Error("Invalid host binding: checkpoint id does not match the active workflow checkpoint.");
    }
  }

  const execution = normalizeExecution(value.execution);
  if (
    found
    && (execution.owner !== found.run.execution.owner || execution.backend !== found.run.execution.backend)
  ) {
    throw new Error("Invalid host binding: execution does not match workflow execution owner and backend.");
  }
  if (!isObject(value.host)) throw new Error("Invalid host binding: host is required.");
  const surface = requiredText(value.host.surface, "host.surface", 64);
  if (!HOST_SURFACES.includes(surface)) {
    throw new Error(`Invalid host binding: unsupported host surface ${surface}.`);
  }
  const host = {
    product: requiredText(value.host.product, "host.product", 64),
    surface,
    version: optionalText(value.host.version, "host.version", 256),
  };

  const mode = requiredText(value.mode, "mode", 32);
  if (!BINDING_MODES.includes(mode)) throw new Error(`Invalid host binding: unsupported mode ${mode}.`);
  if (!isObject(value.provenance)) throw new Error("Invalid host binding: provenance is required.");
  const provenanceKind = requiredText(value.provenance.kind, "provenance.kind", 32);
  if (PROVENANCE_MODES[provenanceKind] !== mode) {
    throw new Error(`Invalid host binding: provenance ${provenanceKind} cannot claim mode ${mode}.`);
  }
  const provenance = {
    kind: provenanceKind,
    capabilitySchemaVersion: optionalText(
      value.provenance.capabilitySchemaVersion,
      "provenance.capabilitySchemaVersion",
      256,
    ),
    authenticationBoundary: requiredText(
      value.provenance.authenticationBoundary,
      "provenance.authenticationBoundary",
      256,
    ),
    recordedAt: normalizeTimestamp(value.provenance.recordedAt, "provenance.recordedAt"),
  };

  if (!isObject(value.references)) throw new Error("Invalid host binding: references are required.");
  const references = {
    goalId: optionalText(value.references.goalId, "references.goalId", 512),
    threadId: optionalText(value.references.threadId, "references.threadId", 512),
    turnId: optionalText(value.references.turnId, "references.turnId", 512),
    subagents: normalizeSubagents(value.references.subagents),
    worktree: normalizeWorktree(value.references.worktree),
  };
  if (
    !references.goalId
    && !references.threadId
    && !references.turnId
    && references.subagents.length === 0
    && !references.worktree
  ) {
    throw new Error("Invalid host binding: at least one host reference is required.");
  }

  if (!isObject(value.controls)) throw new Error("Invalid host binding: controls are required.");
  const controls = Object.fromEntries(
    CONTROL_CLASSES.map((name) => [name, normalizeStringList(value.controls[name], `controls.${name}`)]),
  );

  return {
    schemaVersion: HOST_BINDING_SCHEMA_VERSION,
    workflow,
    execution,
    host,
    mode,
    provenance,
    references,
    controls,
  };
}

function assertBindingCapability(binding, snapshot) {
  const capabilities = validateCodexCapabilitySnapshot(snapshot);
  if (binding.execution.owner === "managed" && binding.host.surface === "chatgpt-desktop") {
    throw new Error("Invalid host binding: managed execution cannot bind to the ChatGPT desktop internal session.");
  }
  if (binding.provenance.kind === "plugin-observed") {
    if (
      capabilities.surfaces.hostObservation.status !== "supported"
      || capabilities.surfaces.hostObservation.pluginPathCapabilityTestPassed !== true
    ) {
      throw new Error(
        "Invalid host binding: plugin path has not passed host observation capability tests.",
      );
    }
    if (binding.provenance.capabilitySchemaVersion !== capabilities.schemaVersion) {
      throw new Error("Invalid host binding: plugin capability schema version does not match the probe.");
    }
  }
  if (binding.provenance.kind === "explicit-intake" && binding.execution.owner !== "native") {
    throw new Error("Invalid host binding: explicit native intake requires native execution ownership.");
  }
  if (binding.provenance.kind === "imported-audit" && binding.execution.owner !== "audit-only") {
    throw new Error("Invalid host binding: imported audit evidence requires audit-only ownership.");
  }
  if (binding.provenance.kind === "managed-backend") {
    if (binding.execution.owner !== "managed") {
      throw new Error("Invalid host binding: managed backend provenance requires managed ownership.");
    }
    const selected = selectManagedBackend(capabilities, binding.execution.backend);
    if (selected !== binding.execution.backend) {
      throw new Error(`Invalid host binding: managed backend ${binding.execution.backend} is not graduated.`);
    }
  }
}

function bindingPath(found) {
  return path.join(found.runRoot, "integration", "host-binding.json");
}

function createHostBinding(found, candidate, options = {}) {
  const binding = validateHostBinding(candidate, found);
  if (!options.capabilities) throw new Error("Host binding requires a versioned capability snapshot.");
  assertBindingCapability(binding, options.capabilities);
  const filePath = bindingPath(found);
  if (fs.existsSync(filePath) && options.replace !== true) {
    throw new Error(`Host binding already exists for workflow run ${found.run.runId}.`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, binding);
  return binding;
}

function loadHostBinding(found) {
  const filePath = bindingPath(found);
  if (!fs.existsSync(filePath)) return null;
  return validateHostBinding(JSON.parse(fs.readFileSync(filePath, "utf8")), found);
}

function createGeneratedGoalBrief(found, taskId) {
  if (found.run.execution.owner !== "native") {
    throw new Error("Generated native goal briefs require native execution ownership.");
  }
  const task = taskId
    ? found.run.tasks.find((entry) => entry.id === taskId)
    : found.run.tasks.find((entry) => ["ready", "running", "verifying", "review-pending"].includes(entry.status));
  if (!task) throw new Error("No resumable native workflow task is available for a goal brief.");
  const workflowTask = found.definition.tasks.find((entry) => entry.id === task.id);
  const checkpointId = task.activeCheckpointId || null;
  const checkpointText = checkpointId ? ` checkpoint ${checkpointId}` : " its next CEWP checkpoint";
  return {
    schemaVersion: GENERATED_GOAL_BRIEF_SCHEMA_VERSION,
    workflow: {
      runId: found.run.runId,
      taskId: task.id,
      checkpointId,
      workflowDigest: found.run.workflow.digest,
    },
    objective: [
      `Continue CEWP workflow run ${found.run.runId}, task ${task.id},${checkpointText}.`,
      `Stay inside these write scopes: ${workflowTask.allowedFiles.join(", ")}.`,
      `Meet these observable stopping conditions: ${workflowTask.stoppingConditions.join("; ")}.`,
      "Return explicit result and verification evidence to CEWP intake.",
      "Do not mark the checkpoint complete or PASS without CEWP verification and reviewer gates.",
    ].join(" "),
    fallback: "explicit-intake",
    claims: {
      liveAttachment: false,
      hostUsageObserved: false,
      hostControlsEnforced: false,
    },
  };
}

module.exports = {
  BINDING_MODES,
  GENERATED_GOAL_BRIEF_SCHEMA_VERSION,
  HOST_BINDING_SCHEMA_VERSION,
  HOST_SURFACES,
  createGeneratedGoalBrief,
  createHostBinding,
  loadHostBinding,
  validateHostBinding,
};
