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

function intervene(repoRoot, runId, taskId, event, reason, classification) {
  const args = [
    "workflow", "intervene", runId,
    "--task", taskId,
    "--event", event,
    "--reason", reason,
  ];
  if (classification) args.push("--classification", classification);
  args.push("--yes", "--json");
  return runNode(cewpCli, args, repoRoot);
}

function start(repoRoot, runId) {
  return runNode(cewpCli, [
    "workflow", "start", runId,
    "--task", "implement-example",
    "--yes",
    "--json",
  ], repoRoot);
}

function runWorkflowInterventionContract() {
  const repoRoot = makeTempRepo("cewp-workflow-intervention-");
  try {
    const definition = validDefinition();
    definition.budget.maxRepairsPerCheckpoint = 1;
    const run = approveWorkflow(repoRoot, definition);
    assert(start(repoRoot, run.runId).status === 0, "first checkpoint starts");

    const blockedResult = intervene(
      repoRoot,
      run.runId,
      "implement-example",
      "block",
      "Focused verification found a regression",
      "new-regression",
    );
    assert(blockedResult.status === 0, `new regression is recorded: ${blockedResult.stderr}`);
    const blocked = JSON.parse(blockedResult.stdout);
    assert(blocked.command === "workflow.intervene", "intervention output identifies the command");
    assert(blocked.data.run.status === "blocked", "blocking failure closes the run gate");
    assert(blocked.data.run.tasks.find((task) => task.id === "implement-example").status === "blocked", "failed task becomes blocked");
    assert(blocked.data.checkpoint.status === "blocked", "active checkpoint becomes blocked");
    assert(blocked.data.checkpoint.failureClassification === "new-regression", "checkpoint records normalized classification");

    const nonWaivable = intervene(
      repoRoot,
      run.runId,
      "implement-example",
      "waive",
      "Do not bypass a real regression",
    );
    assert(nonWaivable.status === 1, "new regression cannot be waived");
    assert(nonWaivable.stderr.includes("non-waivable"), "waiver refusal states the hard boundary");

    const retryResult = intervene(
      repoRoot,
      run.runId,
      "implement-example",
      "retry",
      "Apply a bounded repair in a fresh checkpoint",
    );
    assert(retryResult.status === 0, `blocked task can retry: ${retryResult.stderr}`);
    const retried = JSON.parse(retryResult.stdout).data.run;
    assert(retried.status === "active", "retry reopens the run without claiming success");
    assert(retried.tasks.find((task) => task.id === "implement-example").status === "ready", "retry returns task to ready");

    const secondStart = start(repoRoot, run.runId);
    assert(secondStart.status === 0, `second checkpoint starts: ${secondStart.stderr}`);
    const secondCheckpoint = JSON.parse(secondStart.stdout).data.checkpoint;
    assert(secondCheckpoint.attempt === 2, "retry creates a fresh attempt");
    assert(secondCheckpoint.budget.activeAllocation === "repair", "retry cannot spend implementation allocation");
    const preExisting = intervene(
      repoRoot,
      run.runId,
      "implement-example",
      "block",
      "Baseline failure predates the approved change",
      "pre-existing-failure",
    );
    assert(preExisting.status === 0, "pre-existing failure is recorded as blocked first");
    const waivedResult = intervene(
      repoRoot,
      run.runId,
      "implement-example",
      "waive",
      "Operator accepts the documented pre-existing baseline only",
    );
    assert(waivedResult.status === 0, `waivable baseline exception is approved: ${waivedResult.stderr}`);
    const waived = JSON.parse(waivedResult.stdout).data.run;
    assert(waived.tasks.find((task) => task.id === "implement-example").status === "ready", "waiver returns task to ready, not completed");
    assert(waived.interventions.at(-1).classification === "pre-existing-failure", "approved exception remains in canonical history");
    const exhaustedRepair = start(repoRoot, run.runId);
    assert(exhaustedRepair.status === 1, "waiver cannot expand the repair-attempt budget");
    assert(exhaustedRepair.stderr.includes("repair-attempt budget"), "repair refusal names the exhausted limit");

    const eventsPath = path.join(repoRoot, ".cewp", "workflow-runs", run.runId, "events.jsonl");
    const events = fs.readFileSync(eventsPath, "utf8");
    assert(events.includes("workflow-intervention"), "operator interventions are append-only events");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowInterventionContract();
  console.log("[PASS] workflow interventions preserve non-waivable gates");
} catch (error) {
  console.error("[FAIL] workflow intervention contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
