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
const { approveWorkflow } = require("./workflow-scheduler");
const { loadWorkflowRun } = require("../../src/workflow/state");
const { buildEvidenceReceipt } = require("../../src/evidence/receipt");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function failedResult(run, checkpoint, resultId) {
  return {
    schemaVersion: "task-result/v1",
    resultId,
    runId: run.runId,
    taskId: checkpoint.taskId,
    checkpointId: checkpoint.checkpointId,
    outcome: "failed",
    completedAt: new Date(Date.now() + 1000).toISOString(),
    changedFiles: ["src/example.js"],
    verification: {
      baseline: {
        status: "passed",
        evidence: [{
          command: "node --test tests/example.test.js",
          status: "passed",
          evidencePath: "evidence/baseline.json",
        }],
      },
      targeted: [{
        command: "node --test tests/example.test.js",
        status: "failed",
        evidencePath: "evidence/targeted-failure.json",
      }],
      full: [],
    },
    usage: {
      managedOperations: { label: "observed", value: 1, source: "fake-codex-jsonl" },
      capturedOutputBytes: { label: "observed", value: 192, source: "fake-bounded-output" },
      managedTokens: { label: "unknown", value: null, reason: "fixture omits tokens" },
      hostInternal: { label: "unknown", value: null, reason: "fixture has no host usage" },
    },
    artifacts: [{ kind: "failure-log", path: "evidence/failure.log" }],
    failure: {
      classification: "new-regression",
      signature: "test:example:exit-1:sha256-abcd",
      summary: "The focused example test regressed.",
      evidencePaths: ["evidence/targeted-failure.json"],
    },
  };
}

function startTask(repoRoot, runId) {
  const result = runNode(cewpCli, [
    "workflow", "start", runId,
    "--task", "implement-example", "--yes", "--json",
  ], repoRoot);
  assert(result.status === 0, `failure-result checkpoint starts: ${result.stderr}`);
  return JSON.parse(result.stdout).data.checkpoint;
}

function recordFailure(repoRoot, run, checkpoint, resultId) {
  const fileName = `${resultId}.json`;
  writeJson(path.join(repoRoot, fileName), failedResult(run, checkpoint, resultId));
  return runNode(cewpCli, [
    "workflow", "result", run.runId,
    "--task", "implement-example",
    "--result", fileName, "--yes", "--json",
  ], repoRoot);
}

function retry(repoRoot, runId) {
  return runNode(cewpCli, [
    "workflow", "intervene", runId,
    "--task", "implement-example", "--event", "retry",
    "--reason", "Apply one bounded repair", "--yes", "--json",
  ], repoRoot);
}

function runWorkflowFailureResultContract() {
  const repoRoot = makeTempRepo("cewp-workflow-failure-result-");
  try {
    const definition = validDefinition();
    definition.workflowId = "provider-failure-evidence";
    const run = approveWorkflow(repoRoot, definition);
    const firstCheckpoint = startTask(repoRoot, run.runId);
    const firstResult = recordFailure(repoRoot, run, firstCheckpoint, "implement-example-failure-1");
    assert(firstResult.status === 1, "failed provider result closes CLI success");
    assert(firstResult.stdout.trim().startsWith("{"), "failed provider result returns structured recovery state");
    const first = JSON.parse(firstResult.stdout).data;
    const firstTask = first.run.tasks.find((task) => task.id === "implement-example");
    assert(first.result.outcome === "failed", "provider-neutral result retains failed outcome");
    assert(first.result.failure.classification === "new-regression", "failed result retains normalized classification");
    assert(first.run.status === "blocked" && firstTask.status === "blocked", "failed result blocks run and task without success");
    assert(first.checkpoint.status === "blocked", "failed result blocks its checkpoint");
    assert(firstTask.blocker.source === "task-result", "canonical blocker identifies result provenance");
    assert(firstTask.failureHistory.length === 1, "failed result appends canonical failure history");
    assert(first.run.budget.consumed.modelOperations === 1, "failed managed operation remains observed usage");
    assert(first.run.budget.consumed.targetedVerificationRuns === 2, "failed baseline and targeted checks remain accounted");
    assert(first.run.budget.consumed.capturedOutputBytes === 192, "failed bounded output remains accounted");
    assert(first.progress.nextAction.command.includes("--event retry"), "new regression exposes bounded retry recovery");
    assert(fs.existsSync(path.join(repoRoot, first.resultPath)), "failed task result is persisted as evidence");

    const firstRetry = retry(repoRoot, run.runId);
    assert(firstRetry.status === 0, `first failure permits bounded retry: ${firstRetry.stderr}`);
    const recoveryReceipt = buildEvidenceReceipt(loadWorkflowRun(repoRoot, run.runId), {
      generatedAt: "2026-07-22T15:00:00.000Z",
    });
    const recoveredTask = recoveryReceipt.tasks.find((task) => task.id === "implement-example");
    const failedCheckpoint = recoveryReceipt.checkpoints.find((entry) => entry.checkpointId === firstCheckpoint.checkpointId);
    assert(recoveryReceipt.completeness.status === "partial", "recovery in progress produces a partial receipt");
    assert(failedCheckpoint.status === "blocked" && failedCheckpoint.failureClassification === "new-regression", "receipt identifies the failed checkpoint and classification");
    assert(recoveredTask.recovery.failureHistory[0].checkpointId === firstCheckpoint.checkpointId, "receipt retains the failure that triggered recovery");
    assert(recoveredTask.recovery.interventions.some((entry) => entry.event === "retry" && entry.reason === "Apply one bounded repair"), "receipt explains why the run continued");
    assert(recoveredTask.status === "ready" && recoveredTask.attempts === 1, "receipt shows retry changed the task back to ready without claiming success");
    const secondCheckpoint = startTask(repoRoot, run.runId);
    assert(secondCheckpoint.budget.activeAllocation === "repair", "retry consumes only repair allocation");
    const repeatedResult = recordFailure(repoRoot, run, secondCheckpoint, "implement-example-failure-2");
    assert(repeatedResult.status === 1, "repeated failed result closes CLI success");
    const repeated = JSON.parse(repeatedResult.stdout).data;
    const repeatedTask = repeated.run.tasks.find((task) => task.id === "implement-example");
    assert(repeatedTask.blocker.classification === "repeated-failure", "identical result signature derives repeated failure");
    assert(repeated.result.failure.classification === "new-regression", "stored observation keeps the provider classification");
    assert(repeatedTask.failureHistory.length === 2, "both result observations remain canonical evidence");
    assert(repeated.run.budget.consumed.modelOperations === 2, "failed repair operation remains accounted");
    const refusedRetry = retry(repoRoot, run.runId);
    assert(refusedRetry.status === 1 && refusedRetry.stderr.includes("repeated failure"), "repeated result closes ordinary retry");

    const eventsPath = path.join(repoRoot, ".cewp", "workflow-runs", run.runId, "events.jsonl");
    const events = fs.readFileSync(eventsPath, "utf8");
    assert((events.match(/task-failed/g) || []).length === 2, "failed result observations are append-only events");
  } finally {
    cleanupRepo(repoRoot);
  }
}

function runWorkflowFailureResultRefusalContract() {
  const repoRoot = makeTempRepo("cewp-workflow-failure-result-refusal-");
  try {
    const definition = validDefinition();
    definition.workflowId = "provider-failure-refusal";
    const run = approveWorkflow(repoRoot, definition);
    const checkpoint = startTask(repoRoot, run.runId);

    const outsideScope = failedResult(run, checkpoint, "outside-scope-failure");
    outsideScope.changedFiles = ["README.md"];
    writeJson(path.join(repoRoot, "outside-scope-failure.json"), outsideScope);
    const scopeRefusal = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "outside-scope-failure.json", "--yes", "--json",
    ], repoRoot);
    assert(scopeRefusal.status === 1, "failed result cannot bypass approved file scope");
    assert(scopeRefusal.stderr.includes("outside approved scope"), "failed result scope refusal names the changed file boundary");

    const forgedRepeated = failedResult(run, checkpoint, "forged-repeated-failure");
    forgedRepeated.failure.classification = "repeated-failure";
    writeJson(path.join(repoRoot, "forged-repeated-failure.json"), forgedRepeated);
    const repeatedRefusal = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "forged-repeated-failure.json", "--yes", "--json",
    ], repoRoot);
    assert(repeatedRefusal.status === 1, "provider cannot self-declare repeated failure");
    assert(repeatedRefusal.stderr.includes("derived from canonical failure history"), "repeated-failure refusal names its authority");

    const status = JSON.parse(runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot).stdout).data.run;
    assert(status.status === "active" && status.tasks[0].status === "running", "rejected failure results cannot mutate runtime state");
    assert(status.budget.consumed.modelOperations === 0, "rejected failure results cannot fabricate usage");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "workflow-runs", run.runId, "results")), "rejected failure results are not persisted");
  } finally {
    cleanupRepo(repoRoot);
  }
}

function runUnknownManagedUsageContract() {
  const repoRoot = makeTempRepo("cewp-workflow-failure-result-unknown-");
  try {
    const definition = validDefinition();
    definition.workflowId = "audit-failure-evidence";
    definition.execution = { owner: "audit-only", backend: null, allowedModes: ["audit-only"] };
    const run = approveWorkflow(repoRoot, definition);
    const checkpoint = startTask(repoRoot, run.runId);
    const result = failedResult(run, checkpoint, "audit-failure-result");
    result.usage.managedOperations = {
      label: "unknown",
      value: null,
      reason: "audit-only intake has no CEWP-managed model operation",
    };
    writeJson(path.join(repoRoot, "audit-failure-result.json"), result);
    const recorded = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "audit-failure-result.json", "--yes", "--json",
    ], repoRoot);
    assert(recorded.status === 1, "audit-only failed result returns blocked recovery state");
    const output = JSON.parse(recorded.stdout).data;
    assert(output.result.usage.managedOperations.label === "unknown", "unknown managed usage remains unknown evidence");
    assert(output.run.budget.consumed.modelOperations === 0, "unknown host activity is not fabricated as an observed operation");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowFailureResultContract();
  runWorkflowFailureResultRefusalContract();
  runUnknownManagedUsageContract();
  console.log("[PASS] failed task results retain evidence and bounded recovery");
} catch (error) {
  console.error("[FAIL] workflow failed-result contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
