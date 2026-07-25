"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
} = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function intervene(repoRoot, runId, event, options = {}) {
  const args = [
    "workflow", "intervene", runId,
    "--event", event,
    "--reason", options.reason || `Exercise ${event}`,
  ];
  if (options.taskId) args.push("--task", options.taskId);
  if (options.classification) args.push("--classification", options.classification);
  if (options.signature) args.push("--signature", options.signature);
  if (options.worker) args.push("--worker", options.worker);
  args.push("--yes", "--json");
  return runNode(cewpCli, args, repoRoot);
}

function start(repoRoot, runId, worker) {
  const args = [
    "workflow", "start", runId,
    "--task", "implement-example",
  ];
  if (worker) args.push("--worker", worker);
  args.push("--yes", "--json");
  return runNode(cewpCli, args, repoRoot);
}

function runWorkflowLifecycleContract() {
  const repoRoot = makeTempRepo("cewp-workflow-lifecycle-");
  try {
    const cancelledRun = approveWorkflow(repoRoot, validDefinition());
    const continuedResult = intervene(repoRoot, cancelledRun.runId, "continue", {
      reason: "Operator confirms the next scheduler action",
    });
    assert(continuedResult.status === 0, `approved workflow can continue: ${continuedResult.stderr}`);
    const continued = JSON.parse(continuedResult.stdout).data;
    assert(continued.run.status === "approved", "continue records intent without skipping state");
    assert(continued.progress.nextAction.kind === "start", "continue returns the next safe action");

    const cancelledResult = intervene(repoRoot, cancelledRun.runId, "cancel", {
      reason: "Operator cancels before dispatch",
    });
    assert(cancelledResult.status === 0, `workflow cancels explicitly: ${cancelledResult.stderr}`);
    const cancelled = JSON.parse(cancelledResult.stdout).data.run;
    assert(cancelled.status === "cancelled", "cancel is a terminal non-success run state");
    assert(cancelled.tasks.every((task) => task.status === "cancelled"), "cancel cascades to all unfinished tasks");
    const cancellationEvents = fs.readFileSync(path.join(repoRoot, ".cewp", "workflow-runs", cancelledRun.runId, "events.jsonl"), "utf8");
    assert(cancellationEvents.includes("\"category\":\"cancellation\""), "cancellation has a dedicated lifecycle category");
    const abandonedResult = intervene(repoRoot, cancelledRun.runId, "abandon", {
      reason: "Operator closes the cancelled run",
    });
    assert(abandonedResult.status === 0, `cancelled workflow can be abandoned: ${abandonedResult.stderr}`);
    const abandoned = JSON.parse(abandonedResult.stdout).data.run;
    assert(abandoned.status === "abandoned", "abandon remains distinct from completion");
    assert(abandoned.tasks.every((task) => task.status === "abandoned"), "abandon cascades without fabricating evidence");

    const repeatedDefinition = validDefinition();
    repeatedDefinition.workflowId = "repeated-failure-control";
    repeatedDefinition.budget.maxRepairsPerCheckpoint = 2;
    const repeatedRun = approveWorkflow(repoRoot, repeatedDefinition);
    assert(start(repoRoot, repeatedRun.runId, "worker-1").status === 0, "first assigned checkpoint starts");
    const firstFailure = intervene(repoRoot, repeatedRun.runId, "block", {
      taskId: "implement-example",
      classification: "new-regression",
      signature: "test:example:exit-1:sha256-abcd",
      reason: "Focused test fails with the first observed signature",
    });
    assert(firstFailure.status === 0, `first failure records: ${firstFailure.stderr}`);
    const firstBlocked = JSON.parse(firstFailure.stdout).data;
    assert(firstBlocked.run.tasks[0].blocker.classification === "new-regression", "first signature retains its observed classification");
    assert(firstBlocked.blockedByDependency.some((entry) => entry.id === "document-example"), "failed dependency is explicit scheduler state");
    assert(intervene(repoRoot, repeatedRun.runId, "retry", {
      taskId: "implement-example",
      reason: "One bounded repair is approved",
    }).status === 0, "first failure may use the bounded retry path");
    assert(start(repoRoot, repeatedRun.runId, "worker-1").status === 0, "repair checkpoint starts");

    const repeatedFailure = intervene(repoRoot, repeatedRun.runId, "block", {
      taskId: "implement-example",
      classification: "new-regression",
      signature: "test:example:exit-1:sha256-abcd",
      reason: "The identical focused-test signature repeats",
    });
    assert(repeatedFailure.status === 0, `repeated signature records: ${repeatedFailure.stderr}`);
    const repeated = JSON.parse(repeatedFailure.stdout).data;
    const repeatedTask = repeated.run.tasks.find((task) => task.id === "implement-example");
    assert(repeatedTask.blocker.classification === "repeated-failure", "identical signature is classified automatically");
    assert(repeatedTask.failureHistory.length === 2, "both failure observations remain in canonical history");
    assert(repeated.checkpoint.failureSignature === "test:example:exit-1:sha256-abcd", "checkpoint retains the normalized signature");
    const refusedRetry = intervene(repoRoot, repeatedRun.runId, "retry", {
      taskId: "implement-example",
      reason: "Do not spend another operation on an identical failure",
    });
    assert(refusedRetry.status === 1 && refusedRetry.stderr.includes("repeated failure"), "ordinary retry closes before another model call");
    const refusedWaiver = intervene(repoRoot, repeatedRun.runId, "waive", {
      taskId: "implement-example",
      reason: "Repeated failures cannot be called success",
    });
    assert(refusedWaiver.status === 1 && refusedWaiver.stderr.includes("non-waivable"), "repeated failure cannot be waived");

    const reassignedResult = intervene(repoRoot, repeatedRun.runId, "reassign", {
      taskId: "implement-example",
      worker: "worker-2",
      reason: "Operator explicitly changes the bounded worker strategy",
    });
    assert(reassignedResult.status === 0, `explicit reassign reopens the task: ${reassignedResult.stderr}`);
    const reassigned = JSON.parse(reassignedResult.stdout).data.run;
    assert(reassigned.status === "active", "reassign reopens without claiming success");
    assert(reassigned.tasks[0].status === "ready" && reassigned.tasks[0].assignedWorker === "worker-2", "new worker assignment is canonical");
    const thirdStartResult = start(repoRoot, repeatedRun.runId);
    assert(thirdStartResult.status === 0, `reassigned checkpoint starts: ${thirdStartResult.stderr}`);
    const thirdStart = JSON.parse(thirdStartResult.stdout).data;
    assert(thirdStart.checkpoint.worker.id === "worker-2", "checkpoint records its assigned worker");

    const timedOutResult = intervene(repoRoot, repeatedRun.runId, "timeout", {
      reason: "Absolute checkpoint time ceiling expires",
    });
    assert(timedOutResult.status === 0, `active workflow times out explicitly: ${timedOutResult.stderr}`);
    const timedOut = JSON.parse(timedOutResult.stdout).data;
    assert(timedOut.run.status === "timed-out" && timedOut.run.tasks[0].status === "timed-out", "timeout is never represented as failure or success");
    assert(timedOut.checkpoints[0].status === "timed-out", "active checkpoint records timeout");
    const rolledBackResult = intervene(repoRoot, repeatedRun.runId, "rollback", {
      reason: "Operator rolls back the timed-out checkpoint",
    });
    assert(rolledBackResult.status === 0, `timed-out workflow rolls back: ${rolledBackResult.stderr}`);
    const rolledBack = JSON.parse(rolledBackResult.stdout).data;
    assert(rolledBack.run.status === "rolled-back" && rolledBack.run.tasks[0].status === "rolled-back", "rollback has an explicit terminal state");
    assert(rolledBack.checkpoints[0].status === "rolled-back", "checkpoint rollback is canonical");
    const finalAbandon = intervene(repoRoot, repeatedRun.runId, "abandon", {
      reason: "Operator archives the rolled-back run",
    });
    assert(finalAbandon.status === 0, `rolled-back workflow can be abandoned: ${finalAbandon.stderr}`);
    assert(JSON.parse(finalAbandon.stdout).data.run.status === "abandoned", "rollback never becomes completion during abandon");

    const interruptedRun = approveWorkflow(repoRoot, validDefinition());
    assert(start(repoRoot, interruptedRun.runId).status === 0, "interrupted workflow starts a checkpoint");
    const interruptedResult = intervene(repoRoot, interruptedRun.runId, "interrupt", {
      reason: "Host turn stopped before checkpoint evidence was returned",
    });
    assert(interruptedResult.status === 0, `workflow records interruption: ${interruptedResult.stderr}`);
    const interrupted = JSON.parse(interruptedResult.stdout).data;
    assert(interrupted.run.status === "interrupted", "interruption has a distinct run state");
    assert(interrupted.run.tasks[0].status === "running", "interruption preserves the incomplete task state");
    assert(interrupted.run.interruption.resumeStatus === "active", "interruption remembers the deterministic resume state");
    assert(interrupted.progress.nextAction.kind === "host-resume", "interrupted progress exposes explicit resume");
    const resumedResult = intervene(repoRoot, interruptedRun.runId, "resume", {
      reason: "Host is available and the same checkpoint can continue",
    });
    assert(resumedResult.status === 0, `interrupted workflow resumes: ${resumedResult.stderr}`);
    const resumed = JSON.parse(resumedResult.stdout).data.run;
    assert(resumed.status === "active", "resume restores the prior active run state");
    assert(resumed.tasks[0].status === "running", "resume does not fabricate a fresh checkpoint or evidence");
    assert(resumed.interruption === null, "resume clears the active interruption marker");

    const eventsPath = path.join(repoRoot, ".cewp", "workflow-runs", repeatedRun.runId, "events.jsonl");
    const events = fs.readFileSync(eventsPath, "utf8");
    assert(events.includes("workflow-lifecycle"), "lifecycle decisions are append-only evidence");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowLifecycleContract();
  console.log("[PASS] workflow lifecycle controls stop repeated failures and preserve recovery");
} catch (error) {
  console.error("[FAIL] workflow lifecycle contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
