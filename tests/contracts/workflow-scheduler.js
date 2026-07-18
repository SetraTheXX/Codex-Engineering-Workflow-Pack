"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
  writeJson,
} = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function approveWorkflow(repoRoot, definition) {
  writeJson(path.join(repoRoot, "workflow.json"), definition);
  const preview = runNode(cewpCli, [
    "workflow", "propose", "--proposal", "workflow.json", "--json",
  ], repoRoot);
  assert(preview.status === 0, `scheduler preview succeeds: ${preview.stderr}`);
  const digest = JSON.parse(preview.stdout).data.digest;
  const approval = runNode(cewpCli, [
    "workflow", "approve",
    "--proposal", "workflow.json",
    "--digest", digest,
    "--yes",
    "--json",
  ], repoRoot);
  assert(approval.status === 0, `scheduler approval succeeds: ${approval.stderr}`);
  return JSON.parse(approval.stdout).data.run;
}

function runWorkflowSchedulerContract() {
  const repoRoot = makeTempRepo("cewp-workflow-scheduler-");
  try {
    const definition = validDefinition();
    definition.tasks.push(
      {
        ...definition.tasks[0],
        id: "parallel-b",
        title: "Independent parallel task B",
        allowedFiles: ["src/parallel-b.js"],
      },
      {
        ...definition.tasks[0],
        id: "parallel-c",
        title: "Independent parallel task C",
        allowedFiles: ["src/parallel-c.js"],
      },
    );
    definition.budget.maxTargetedVerificationRuns = 20;
    const run = approveWorkflow(repoRoot, definition);
    const statusResult = runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot);
    assert(statusResult.status === 0, `workflow status succeeds: ${statusResult.stderr}`);
    const status = JSON.parse(statusResult.stdout);
    assert(status.command === "workflow.status", "status output identifies the command");
    assert(status.data.run.schemaVersion === "run-state/v2", "status reads the current run contract");
    assert(status.data.readyTasks.map((task) => task.id).join(",") === "implement-example,parallel-b", "ready tasks are selected deterministically up to capacity");
    assert(status.data.queuedReadyTasks.map((task) => task.id).join(",") === "parallel-c", "excess ready task remains queued");
    assert(status.data.capacity.maximum === 2, "approved worker bound is visible");
    assert(status.data.capacity.available === 2, "unused worker capacity is derived");

    const premature = runNode(cewpCli, [
      "workflow", "start", run.runId,
      "--task", "document-example",
      "--yes",
      "--json",
    ], repoRoot);
    assert(premature.status === 1, "task with an incomplete dependency cannot start");
    assert(premature.stderr.includes("not ready"), "premature start explains the scheduler gate");

    const startedResult = runNode(cewpCli, [
      "workflow", "start", run.runId,
      "--task", "implement-example",
      "--yes",
      "--json",
    ], repoRoot);
    assert(startedResult.status === 0, `ready task starts: ${startedResult.stderr}`);
    const started = JSON.parse(startedResult.stdout);
    assert(started.command === "workflow.start", "start output identifies the command");
    assert(started.data.checkpoint.schemaVersion === "task-checkpoint/v1", "task start creates a versioned checkpoint");
    assert(started.data.run.tasks.find((task) => task.id === "implement-example").status === "running", "started task becomes running");
    assert(started.data.capacity.available === 1, "active task consumes one worker slot");
    assert(started.data.run.budget.consumed.modelOperations === 0, "local scheduling does not fabricate a model operation");
    assert(fs.existsSync(path.join(repoRoot, started.data.checkpointPath)), "checkpoint is persisted beside the run");

    const secondStart = runNode(cewpCli, [
      "workflow", "start", run.runId,
      "--task", "parallel-b",
      "--yes",
      "--json",
    ], repoRoot);
    assert(secondStart.status === 0, `second worker slot can start: ${secondStart.stderr}`);
    const exhausted = runNode(cewpCli, [
      "workflow", "start", run.runId,
      "--task", "parallel-c",
      "--yes",
      "--json",
    ], repoRoot);
    assert(exhausted.status === 1, "third task cannot exceed approved concurrency");
    assert(exhausted.stderr.includes("no worker capacity"), "concurrency refusal names the exhausted resource");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowSchedulerContract();
  console.log("[PASS] workflow scheduler derives deterministic ready tasks");
} catch (error) {
  console.error("[FAIL] workflow scheduler contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}

module.exports = {
  approveWorkflow,
};
