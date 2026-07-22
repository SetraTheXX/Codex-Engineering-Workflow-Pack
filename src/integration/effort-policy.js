"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { appendEvent, findSupervisedRun, getNextAction } = require("../supervise/state");
const { writeJsonAtomic } = require("../workflow/state");

const CODEX_EFFORT_POLICY_SCHEMA_VERSION = "codex-effort-policy/v1";
const CODEX_TASK_CLASSES = Object.freeze([
  "fast-exploration",
  "demanding-implementation",
  "high-effort-independent-review",
]);
const CODEX_EFFORT_OPERATIONS = Object.freeze(["implementation", "repair", "reviewer"]);
const CODEX_REASONING_EFFORTS = Object.freeze(["minimal", "low", "medium", "high", "xhigh"]);

function requiredChoice(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function optionalSelection(value, label) {
  if (value === undefined || value === null) return { status: "unknown", value: null };
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${label} must be bounded non-empty text.`);
  }
  return { status: "explicit", value: value.trim() };
}

function effortPolicyPath(found) {
  return path.join(found.runRoot, "integration", "codex-effort-policy.json");
}

function selectionDigest(operation, assignment) {
  const content = JSON.stringify({
    operation,
    workflow: assignment.workflow,
    taskClass: assignment.taskClass,
    model: assignment.requested.model,
    effort: assignment.requested.effort,
  });
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function assignmentSnapshot(assignment) {
  if (!assignment) return null;
  return {
    workflow: assignment.workflow,
    taskClass: assignment.taskClass,
    requested: assignment.requested,
    approval: assignment.approval,
  };
}

function validateAssignment(operation, assignment, found, options = {}) {
  if (!assignment || typeof assignment !== "object") {
    throw new Error(`Invalid Codex effort assignment for ${operation}.`);
  }
  requiredChoice(assignment.taskClass, CODEX_TASK_CLASSES, `${operation}.taskClass`);
  if (
    !assignment.workflow
    || !Number.isInteger(assignment.workflow.planRevision)
    || assignment.workflow.planRevision <= 0
    || typeof assignment.workflow.checkpointId !== "string"
    || assignment.workflow.checkpointId.length === 0
  ) {
    throw new Error(`Invalid Codex effort workflow binding for ${operation}.`);
  }
  const model = optionalSelection(
    assignment.requested && assignment.requested.model && assignment.requested.model.value,
    `${operation}.requested.model`,
  );
  const effortValue = assignment.requested && assignment.requested.effort && assignment.requested.effort.value;
  if (effortValue !== null && effortValue !== undefined) {
    requiredChoice(effortValue, CODEX_REASONING_EFFORTS, `${operation}.requested.effort`);
  }
  const effort = optionalSelection(effortValue, `${operation}.requested.effort`);
  const normalized = {
    ...assignment,
    requested: { model, effort },
  };
  if (
    !assignment.approval
    || assignment.approval.kind !== "operator"
    || assignment.approval.selectionDigest !== selectionDigest(operation, normalized)
  ) {
    throw new Error(`Codex effort assignment for ${operation} is not operator-approved or was modified.`);
  }
  if (
    options.allowStale !== true
    && (
      assignment.workflow.planRevision !== found.run.planRevision
      || assignment.workflow.checkpointId !== found.run.tasks[0].id
    )
  ) {
    throw new Error(`Codex effort assignment for ${operation} was not approved for the current plan revision and checkpoint.`);
  }
  return normalized;
}

function loadCodexEffortPolicy(found, options = {}) {
  const filePath = effortPolicyPath(found);
  if (!fs.existsSync(filePath)) return null;
  const policy = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (policy.schemaVersion !== CODEX_EFFORT_POLICY_SCHEMA_VERSION || policy.runId !== found.runId) {
    throw new Error(`Invalid Codex effort policy for run ${found.runId}.`);
  }
  if (policy.provider !== "codex" || policy.automaticModelRouting !== false) {
    throw new Error("Invalid Codex effort policy provider or routing boundary.");
  }
  return {
    ...policy,
    assignments: Object.fromEntries(Object.entries(policy.assignments || {}).map(([operation, assignment]) => {
      requiredChoice(operation, CODEX_EFFORT_OPERATIONS, "effort policy operation");
      return [operation, validateAssignment(operation, assignment, found, options)];
    })),
  };
}

function approveCodexEffortPolicy(options = {}) {
  if (!options.yes) {
    throw new Error("Codex effort policy changes require explicit operator approval with --yes.");
  }
  const found = findSupervisedRun(options);
  const operation = requiredChoice(options.operation, CODEX_EFFORT_OPERATIONS, "--operation");
  const taskClass = requiredChoice(options.taskClass, CODEX_TASK_CLASSES, "--task-class");
  if (options.effort !== undefined) {
    requiredChoice(options.effort, CODEX_REASONING_EFFORTS, "--effort");
  }
  const previous = loadCodexEffortPolicy(found, { allowStale: true });
  const revision = previous ? previous.revision + 1 : 1;
  const approvedAt = new Date().toISOString();
  const assignment = {
    workflow: {
      planRevision: found.run.planRevision,
      checkpointId: found.run.tasks[0].id,
    },
    taskClass,
    requested: {
      model: optionalSelection(options.model, "--model"),
      effort: optionalSelection(options.effort, "--effort"),
    },
    approval: {
      kind: "operator",
      event: "codex-effort-policy-approved",
      revision,
      approvedAt,
      selectionDigest: null,
    },
  };
  assignment.approval.selectionDigest = selectionDigest(operation, assignment);
  const previousAssignment = previous ? previous.assignments[operation] || null : null;
  const policy = {
    schemaVersion: CODEX_EFFORT_POLICY_SCHEMA_VERSION,
    runId: found.runId,
    provider: "codex",
    automaticModelRouting: false,
    revision,
    updatedAt: approvedAt,
    assignments: {
      ...(previous ? previous.assignments : {}),
      [operation]: assignment,
    },
    history: [
      ...(previous ? previous.history : []),
      {
        revision,
        operation,
        taskClass,
        approvedAt,
        previousRevision: previous ? previous.revision : null,
        previous: assignmentSnapshot(previousAssignment),
        next: assignmentSnapshot(assignment),
      },
    ],
  };
  const filePath = effortPolicyPath(found);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, policy);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: approvedAt,
    type: "codex-effort-policy-approved",
    runId: found.runId,
    planRevision: found.run.planRevision,
    checkpointId: found.run.tasks[0].id,
    actor: "operator",
    operation,
    revision,
    selectionDigest: assignment.approval.selectionDigest,
  });
  return {
    run: found.run,
    effortPolicy: policy,
    nextAction: getNextAction(found.run),
  };
}

function resolveCodexEffortForDispatch(found, operation) {
  requiredChoice(operation, CODEX_EFFORT_OPERATIONS, "Codex dispatch operation");
  const policy = loadCodexEffortPolicy(found);
  const assignment = policy && policy.assignments[operation];
  if (!assignment) {
    return {
      model: undefined,
      effort: undefined,
      evidence: {
        taskClass: null,
        policyRevision: policy ? policy.revision : null,
        selectedModel: { status: "unknown", value: null },
        selectedEffort: { status: "unknown", value: null },
        effectiveModel: { status: "unknown", value: null, source: "not-explicitly-selected" },
        effectiveEffort: { status: "unknown", value: null, source: "not-explicitly-selected" },
      },
    };
  }
  const model = assignment.requested.model.value || undefined;
  const effort = assignment.requested.effort.value || undefined;
  return {
    model,
    effort,
    evidence: {
      taskClass: assignment.taskClass,
      policyRevision: policy.revision,
      selectedModel: assignment.requested.model,
      selectedEffort: assignment.requested.effort,
      effectiveModel: { status: "unknown", value: null, source: model ? "awaiting-supported-turn-evidence" : "not-explicitly-selected" },
      effectiveEffort: { status: "unknown", value: null, source: effort ? "awaiting-supported-turn-evidence" : "not-explicitly-selected" },
    },
  };
}

function confirmCodexEffortEvidence(evidence, usage) {
  const confirmed = usage && usage.label === "observed";
  const effective = (selected) => (
    confirmed && selected && selected.status === "explicit"
      ? { status: "known", value: selected.value, source: "codex-exec-turn-completed-usage" }
      : {
        status: "unknown",
        value: null,
        source: selected && selected.status === "explicit"
          ? "supported-turn-evidence-unavailable"
          : "not-explicitly-selected",
      }
  );
  return {
    ...evidence,
    effectiveModel: effective(evidence.selectedModel),
    effectiveEffort: effective(evidence.selectedEffort),
  };
}

module.exports = {
  CODEX_EFFORT_OPERATIONS,
  CODEX_EFFORT_POLICY_SCHEMA_VERSION,
  CODEX_REASONING_EFFORTS,
  CODEX_TASK_CLASSES,
  approveCodexEffortPolicy,
  confirmCodexEffortEvidence,
  loadCodexEffortPolicy,
  resolveCodexEffortForDispatch,
};
