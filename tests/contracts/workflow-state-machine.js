"use strict";

const { assert } = require("../harness/lib/assertions");
const {
  FAILURE_CLASSIFICATIONS,
  assertWaivableClassification,
  transitionCheckpoint,
  transitionRun,
  transitionTask,
} = require("../../src/workflow/transitions");

function assertThrows(action, expected, label) {
  try {
    action();
  } catch (error) {
    assert(error.message.includes(expected), `${label}: ${error.message}`);
    return;
  }
  throw new Error(`${label}: expected an error containing ${expected}`);
}

function runWorkflowStateMachineContract() {
  assertThrows(
    () => transitionTask("ready", "verification-passed"),
    "Illegal task transition",
    "task cannot skip execution and evidence",
  );

  for (const classification of FAILURE_CLASSIFICATIONS) {
    assert(transitionTask("running", classification) === "blocked", `${classification} blocks a running task`);
    assert(transitionCheckpoint("running", classification) === "blocked", `${classification} blocks a running checkpoint`);
  }
  assert(transitionTask("running", "timeout") === "timed-out", "task timeout is distinct from success");
  assert(transitionTask("timed-out", "rollback") === "rolled-back", "timed-out work can roll back");
  assert(transitionTask("ready", "cancel") === "cancelled", "ready task can cancel explicitly");
  assert(transitionTask("cancelled", "abandon") === "abandoned", "cancelled task can be abandoned explicitly");
  let task = transitionTask("pending", "dependencies-satisfied");
  task = transitionTask(task, "start");
  task = transitionTask(task, "result-recorded");
  task = transitionTask(task, "verification-passed");
  assert(task === "completed", "legal task chain reaches completed");

  let checkpoint = transitionCheckpoint("running", "result-recorded");
  checkpoint = transitionCheckpoint(checkpoint, "verification-passed");
  assert(checkpoint === "verified", "checkpoint requires result before verification");

  let run = transitionRun("approved", "task-started");
  run = transitionRun(run, "pause-budget-unverified");
  assert(run === "paused-budget-unverified", "run records an unverified budget pause");
  run = transitionRun(run, "resume");
  assert(run === "active", "paused run resumes through an explicit event");
  assert(transitionRun("active", "pause-host-limit") === "paused-host-limit", "host limit has its own pause state");
  assert(transitionRun("active", "interrupt") === "interrupted", "interruption is distinct from failure and cancellation");
  assert(transitionRun("interrupted", "resume") === "active", "interrupted run has an explicit resume path");
  assert(transitionRun("active", "timeout") === "timed-out", "run timeout is not generic failure");

  assertWaivableClassification("pre-existing-failure");
  assertThrows(
    () => assertWaivableClassification("new-regression"),
    "non-waivable",
    "new regressions cannot be waived",
  );
}

try {
  runWorkflowStateMachineContract();
  console.log("[PASS] workflow state transitions reject skipped success");
} catch (error) {
  console.error("[FAIL] workflow state-machine contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
