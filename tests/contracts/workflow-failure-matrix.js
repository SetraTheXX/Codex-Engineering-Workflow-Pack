"use strict";

const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
  writeJson,
} = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");
const policies = [
  ["baseline-failure", "revise"],
  ["new-regression", "retry"],
  ["pre-existing-failure", "waive"],
  ["environment-failure", "retry"],
  ["dependency-failure", "retry"],
  ["flaky-result", "retry"],
  ["invalid-test", "revise"],
  ["ambiguous-requirement", "revise"],
  ["non-waivable-gate", "revise"],
];

function intervene(repoRoot, runId, event, classification) {
  const args = [
    "workflow", "intervene", runId,
    "--task", "implement-example",
    "--event", event,
    "--reason", `Exercise ${classification} ${event} policy`,
  ];
  if (event === "block") {
    args.push("--classification", classification, "--signature", `check:${classification}:exit-1`);
  }
  args.push("--yes", "--json");
  return runNode(cewpCli, args, repoRoot);
}

function runFailurePolicyMatrix() {
  const repoRoot = makeTempRepo("cewp-workflow-failure-matrix-");
  try {
    for (const [classification, recovery] of policies) {
      const definition = validDefinition();
      definition.workflowId = `failure-${classification}`;
      const run = approveWorkflow(repoRoot, definition);
      const started = runNode(cewpCli, [
        "workflow", "start", run.runId,
        "--task", "implement-example", "--yes", "--json",
      ], repoRoot);
      assert(started.status === 0, `${classification} checkpoint starts: ${started.stderr}`);

      const blockedResult = intervene(repoRoot, run.runId, "block", classification);
      assert(blockedResult.status === 0, `${classification} records through the public intervention: ${blockedResult.stderr}`);
      const blocked = JSON.parse(blockedResult.stdout).data;
      const task = blocked.run.tasks.find((entry) => entry.id === "implement-example");
      assert(blocked.run.status === "blocked" && task.status === "blocked", `${classification} never appears as success`);
      assert(task.blocker.classification === classification, `${classification} remains canonical blocker state`);
      assert(blocked.checkpoint.failureClassification === classification, `${classification} remains checkpoint evidence`);
      assert(blocked.progress.nextAction.kind === (recovery === "revise" ? "revision" : "intervention"), `${classification} exposes the expected recovery kind`);
      assert(blocked.progress.nextAction.command.includes(recovery === "revise" ? "workflow revise" : `--event ${recovery}`), `${classification} exposes ${recovery} as the safe action`);

      const waiver = intervene(repoRoot, run.runId, "waive", classification);
      if (recovery === "waive") {
        assert(waiver.status === 0, `${classification} requires explicit operator waiver`);
        const waived = JSON.parse(waiver.stdout).data.run.tasks.find((entry) => entry.id === "implement-example");
        assert(waived.status === "ready" && waived.resultId === null, "waiver reopens work without claiming completion");
      } else {
        assert(waiver.status === 1 && waiver.stderr.includes("non-waivable"), `${classification} cannot be waived`);
      }

      if (recovery === "retry") {
        const retried = intervene(repoRoot, run.runId, "retry", classification);
        assert(retried.status === 0, `${classification} permits one bounded retry: ${retried.stderr}`);
        assert(JSON.parse(retried.stdout).data.run.tasks.find((entry) => entry.id === "implement-example").status === "ready", "retry returns to ready only");
      } else if (recovery === "revise") {
        const refusedRetry = intervene(repoRoot, run.runId, "retry", classification);
        assert(refusedRetry.status === 1, `${classification} refuses blind retry`);
        assert(refusedRetry.stderr.includes("requires workflow revision"), `${classification} retry refusal names the replan path`);
      }
    }

    const replanDefinition = validDefinition();
    replanDefinition.workflowId = "ambiguous-replan";
    const replanRun = approveWorkflow(repoRoot, replanDefinition);
    assert(runNode(cewpCli, [
      "workflow", "start", replanRun.runId,
      "--task", "implement-example", "--yes", "--json",
    ], repoRoot).status === 0, "ambiguous replan checkpoint starts");
    assert(intervene(repoRoot, replanRun.runId, "block", "ambiguous-requirement").status === 0, "ambiguous requirement blocks before replan");
    const revision = validDefinition();
    revision.workflowId = replanDefinition.workflowId;
    revision.revision = {
      number: 2,
      parent: replanRun.workflow.digest,
      reason: "Clarify the ambiguous checkpoint acceptance criteria",
    };
    revision.tasks[0].title = "Implement the clarified bounded example";
    revision.tasks[0].stoppingConditions = ["The clarified focused example check passes"];
    writeJson(path.join(repoRoot, "ambiguous-revision.json"), revision);
    const previewResult = runNode(cewpCli, [
      "workflow", "revise", replanRun.runId,
      "--proposal", "ambiguous-revision.json", "--json",
    ], repoRoot);
    assert(previewResult.status === 0, `ambiguous replan preview succeeds: ${previewResult.stderr}`);
    const preview = JSON.parse(previewResult.stdout).data;
    assert(preview.diff.changedTasks.includes("implement-example"), "replan diff identifies the clarified checkpoint");
    const stillBlocked = JSON.parse(runNode(cewpCli, [
      "workflow", "status", replanRun.runId, "--json",
    ], repoRoot).stdout).data.run;
    assert(stillBlocked.status === "blocked", "revision preview never mutates blocked state");
    const appliedResult = runNode(cewpCli, [
      "workflow", "apply-revision", replanRun.runId,
      "--proposal", "ambiguous-revision.json",
      "--digest", preview.digest,
      "--yes", "--json",
    ], repoRoot);
    assert(appliedResult.status === 0, `explicit ambiguous replan applies: ${appliedResult.stderr}`);
    const replanned = JSON.parse(appliedResult.stdout).data.run;
    const replannedTask = replanned.tasks.find((entry) => entry.id === "implement-example");
    assert(replanned.status === "active" && replannedTask.status === "ready", "approved replan reopens only the clarified work");
    assert(replannedTask.resultId === null && replannedTask.verification === null, "replan never fabricates completion evidence");
    assert(replannedTask.stateHistory.at(-1).blocker.classification === "ambiguous-requirement", "replan archives the original blocker");
    assert(replanned.revisionHistory.at(-1).reason === revision.revision.reason, "replan history explains why the graph changed");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runFailurePolicyMatrix();
  console.log("[PASS] workflow failure classes expose bounded recovery policies");
} catch (error) {
  console.error("[FAIL] workflow failure policy matrix");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
