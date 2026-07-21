"use strict";

const FAILURE_CLASSIFICATIONS = Object.freeze([
  "baseline-failure",
  "new-regression",
  "pre-existing-failure",
  "environment-failure",
  "dependency-failure",
  "flaky-result",
  "invalid-test",
  "ambiguous-requirement",
  "repeated-failure",
  "non-waivable-gate",
]);
const WAIVABLE_FAILURES = new Set(["pre-existing-failure"]);
const REVISION_REQUIRED_FAILURES = new Set([
  "baseline-failure",
  "invalid-test",
  "ambiguous-requirement",
  "non-waivable-gate",
]);

const FAILURE_EVENTS = Object.freeze(Object.fromEntries(
  FAILURE_CLASSIFICATIONS.map((classification) => [classification, "blocked"]),
));

const TASK_TRANSITIONS = Object.freeze({
  pending: {
    "dependencies-satisfied": "ready",
    block: "blocked",
    cancel: "cancelled",
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  ready: {
    start: "running",
    revise: "ready",
    reassign: "ready",
    block: "blocked",
    cancel: "cancelled",
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  running: {
    "result-recorded": "verifying",
    ...FAILURE_EVENTS,
    block: "blocked",
    timeout: "timed-out",
    cancel: "cancelled",
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  verifying: {
    "verification-passed": "completed",
    "verification-passed-review-required": "review-pending",
    ...FAILURE_EVENTS,
    block: "blocked",
    timeout: "timed-out",
    cancel: "cancelled",
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  "review-pending": {
    "reviewer-pass": "completed",
    "reviewer-block": "blocked",
    timeout: "timed-out",
    cancel: "cancelled",
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  blocked: {
    retry: "ready",
    revise: "ready",
    reassign: "ready",
    waive: "ready",
    rollback: "rolled-back",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  failed: {
    retry: "ready",
    revise: "ready",
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  "timed-out": {
    retry: "ready",
    revise: "ready",
    rollback: "rolled-back",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  completed: {
    "reviewer-block": "blocked",
    rollback: "rolled-back",
  },
  cancelled: {
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  "rolled-back": {
    abandon: "abandoned",
  },
  abandoned: {},
});

const CHECKPOINT_TRANSITIONS = Object.freeze({
  running: {
    "result-recorded": "result-recorded",
    ...FAILURE_EVENTS,
    block: "blocked",
    timeout: "timed-out",
    cancel: "cancelled",
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  "result-recorded": {
    "verification-passed": "verified",
    ...FAILURE_EVENTS,
    block: "blocked",
    timeout: "timed-out",
    cancel: "cancelled",
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  blocked: {
    rollback: "rolled-back",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  "timed-out": {
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  verified: {
    "reviewer-block": "blocked",
    rollback: "rolled-back",
  },
  cancelled: {
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  "rolled-back": {
    abandon: "abandoned",
  },
  abandoned: {},
});

const RUN_TRANSITIONS = Object.freeze({
  approved: {
    "task-started": "active",
    "pause-budget-safe": "paused-budget-safe",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  active: {
    "task-started": "active",
    "pause-budget-safe": "paused-budget-safe",
    "pause-budget-unverified": "paused-budget-unverified",
    "pause-host-limit": "paused-host-limit",
    block: "blocked",
    "tasks-completed": "review-pending",
    "tasks-completed-no-review": "completed",
    cancel: "cancelled",
    timeout: "timed-out",
    abandon: "abandoned",
  },
  "paused-budget-safe": {
    resume: "active",
    "add-budget": "active",
    "reduce-scope": "active",
    rollback: "rolled-back",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  "paused-budget-unverified": {
    resume: "active",
    "add-budget": "active",
    "reduce-scope": "active",
    rollback: "rolled-back",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  "paused-host-limit": {
    resume: "active",
    rollback: "rolled-back",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  blocked: {
    retry: "active",
    revise: "active",
    reassign: "active",
    waive: "active",
    rollback: "rolled-back",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  "timed-out": {
    retry: "active",
    resume: "active",
    rollback: "rolled-back",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  "review-pending": {
    "pause-budget-safe": "paused-budget-safe",
    "pause-host-limit": "paused-host-limit",
    "reviewer-pass": "completed",
    "reviewer-block": "blocked",
    cancel: "cancelled",
    abandon: "abandoned",
  },
  completed: {
    finalize: "finalized",
    rollback: "rolled-back",
  },
  cancelled: {
    rollback: "rolled-back",
    abandon: "abandoned",
  },
  "rolled-back": {
    abandon: "abandoned",
  },
  abandoned: {},
  finalized: {},
});

function transition(kind, table, current, event) {
  const next = table[current] && table[current][event];
  if (!next) throw new Error(`Illegal ${kind} transition: ${current} + ${event}.`);
  return next;
}

function transitionTask(current, event) {
  return transition("task", TASK_TRANSITIONS, current, event);
}

function transitionCheckpoint(current, event) {
  return transition("checkpoint", CHECKPOINT_TRANSITIONS, current, event);
}

function transitionRun(current, event) {
  return transition("run", RUN_TRANSITIONS, current, event);
}

function validateFailureClassification(classification) {
  if (!FAILURE_CLASSIFICATIONS.includes(classification)) {
    throw new Error(`Unsupported failure classification: ${classification || "missing"}.`);
  }
  return classification;
}

function normalizeFailureSignature(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Failure signature is required.");
  }
  const signature = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9:._-]{2,127}$/.test(signature)) {
    throw new Error("Failure signature must be a normalized lowercase identifier.");
  }
  return signature;
}

function assertWaivableClassification(classification) {
  validateFailureClassification(classification);
  if (!WAIVABLE_FAILURES.has(classification)) {
    throw new Error(`Failure classification ${classification} is non-waivable.`);
  }
  return classification;
}

module.exports = {
  CHECKPOINT_TRANSITIONS,
  FAILURE_CLASSIFICATIONS,
  REVISION_REQUIRED_FAILURES,
  RUN_TRANSITIONS,
  TASK_TRANSITIONS,
  WAIVABLE_FAILURES,
  assertWaivableClassification,
  normalizeFailureSignature,
  transitionCheckpoint,
  transitionRun,
  transitionTask,
  validateFailureClassification,
};
