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
const { successfulResult } = require("./workflow-result");
const { approveWorkflow } = require("./workflow-scheduler");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function singleTaskDefinition() {
  const definition = validDefinition();
  definition.workflowId = "reviewed-change";
  definition.tasks = [definition.tasks[0]];
  definition.budget.maxTargetedVerificationRuns = 6;
  definition.budget.maxFullVerificationRuns = 1;
  return definition;
}

function createReviewPendingRun(repoRoot) {
  const run = approveWorkflow(repoRoot, singleTaskDefinition());
  const startedResult = runNode(cewpCli, [
    "workflow", "start", run.runId,
    "--task", "implement-example",
    "--yes", "--json",
  ], repoRoot);
  assert(startedResult.status === 0, `review fixture task starts: ${startedResult.stderr}`);
  const started = JSON.parse(startedResult.stdout).data;
  const taskResult = successfulResult(run, started.checkpoint, [{
    command: "node --test tests/example.test.js",
    status: "passed",
    evidencePath: "evidence/targeted.json",
  }]);
  writeJson(path.join(repoRoot, `${run.runId}-task-result.json`), taskResult);
  const recorded = runNode(cewpCli, [
    "workflow", "result", run.runId,
    "--task", "implement-example",
    "--result", `${run.runId}-task-result.json`,
    "--yes", "--json",
  ], repoRoot);
  assert(recorded.status === 0, `review fixture result records: ${recorded.stderr}`);
  assert(JSON.parse(recorded.stdout).data.run.status === "review-pending", "verified tasks stop at the reviewer gate");
  return run;
}

function reviewResult(run, decision = "PASS") {
  return {
    schemaVersion: "review-result/v1",
    reviewId: `${run.runId}-${decision.toLowerCase().replace("_", "-")}`,
    runId: run.runId,
    workflowDigest: run.workflow.digest,
    completedAt: new Date().toISOString(),
    independent: true,
    decision,
    summary: `Independent reviewer decision: ${decision}`,
    findings: decision === "PASS" ? [] : [{
      taskId: "implement-example",
      classification: "new-regression",
      severity: "high",
      summary: "A bounded correction is required.",
      evidencePaths: ["evidence/review-finding.json"],
    }],
    evidence: [{ kind: "review-report", path: "evidence/review.md" }],
    usage: {
      managedOperations: { label: "observed", value: 1, source: "codex-exec-jsonl" },
      capturedOutputBytes: { label: "observed", value: 128, source: "cewp-bounded-output" },
      managedTokens: { label: "unknown", value: null, reason: "fixture omits token totals" },
      hostInternal: { label: "unknown", value: null, reason: "host usage is unavailable" },
    },
  };
}

function runWorkflowReviewContract() {
  const repoRoot = makeTempRepo("cewp-workflow-review-");
  try {
    const passRun = createReviewPendingRun(repoRoot);
    const prematureFinalize = runNode(cewpCli, [
      "workflow", "finalize", passRun.runId, "--yes", "--json",
    ], repoRoot);
    assert(prematureFinalize.status === 1, "finalize rejects a run before reviewer PASS");
    assert(prematureFinalize.stderr.includes("review-pending"), "premature finalize names the closed gate");

    const untrustedReview = reviewResult(passRun);
    untrustedReview.independent = false;
    writeJson(path.join(repoRoot, "untrusted-review.json"), untrustedReview);
    const untrusted = runNode(cewpCli, [
      "workflow", "review", passRun.runId,
      "--result", "untrusted-review.json",
      "--yes", "--json",
    ], repoRoot);
    assert(untrusted.status === 1, "self-review cannot satisfy the independent reviewer gate");
    assert(untrusted.stderr.includes("independent"), "self-review refusal explains the trust boundary");

    const pausedResult = runNode(cewpCli, [
      "workflow", "intervene", passRun.runId,
      "--event", "pause-budget-safe",
      "--reason", "Operator pauses before spending reviewer reserve",
      "--yes", "--json",
    ], repoRoot);
    assert(pausedResult.status === 0, `review gate pauses safely: ${pausedResult.stderr}`);
    const paused = JSON.parse(pausedResult.stdout).data.run;
    assert(paused.status === "paused-budget-safe", "review gate uses the safe budget pause state");
    assert(paused.budget.resumeStatus === "review-pending", "pause retains the exact review gate");
    const resumedResult = runNode(cewpCli, [
      "workflow", "intervene", passRun.runId,
      "--event", "resume",
      "--reason", "Operator restores the reviewer operation",
      "--yes", "--json",
    ], repoRoot);
    assert(resumedResult.status === 0, `review gate resumes: ${resumedResult.stderr}`);
    assert(JSON.parse(resumedResult.stdout).data.run.status === "review-pending", "resume cannot skip or rewind the reviewer gate");

    const contradictoryReview = reviewResult(passRun);
    contradictoryReview.findings = [{
      taskId: "implement-example",
      classification: "new-regression",
      severity: "medium",
      summary: "PASS must not hide an unresolved classified failure.",
      evidencePaths: ["evidence/contradiction.json"],
    }];
    writeJson(path.join(repoRoot, "contradictory-review.json"), contradictoryReview);
    const contradictory = runNode(cewpCli, [
      "workflow", "review", passRun.runId,
      "--result", "contradictory-review.json",
      "--yes", "--json",
    ], repoRoot);
    assert(contradictory.status === 1, "PASS cannot conceal a classified failure");

    writeJson(path.join(repoRoot, "passing-review.json"), reviewResult(passRun));
    const missingApproval = runNode(cewpCli, [
      "workflow", "review", passRun.runId,
      "--result", "passing-review.json", "--json",
    ], repoRoot);
    assert(missingApproval.status === 1, "review recording requires explicit approval");

    const passedResult = runNode(cewpCli, [
      "workflow", "review", passRun.runId,
      "--result", "passing-review.json",
      "--yes", "--json",
    ], repoRoot);
    assert(passedResult.status === 0, `independent PASS records: ${passedResult.stderr}`);
    const passed = JSON.parse(passedResult.stdout);
    assert(passed.command === "workflow.review", "review output identifies the command");
    assert(passed.data.run.status === "completed", "reviewer PASS opens completion");
    assert(passed.data.run.reviewer.status === "passed", "reviewer PASS is canonical state");
    assert(passed.data.run.budget.consumed.allocations.reviewer === 1, "review usage consumes only the reviewer allocation");
    assert(passed.data.run.budget.consumed.capturedOutputBytes === 384, "review output adds to the bounded canonical total");
    assert(passed.data.progress.nextAction.kind === "finalize", "progress exposes explicit finalization only after PASS");
    assert(fs.existsSync(path.join(repoRoot, passed.data.reviewPath)), "validated review evidence is persisted under the run");

    const noFinalizeApproval = runNode(cewpCli, [
      "workflow", "finalize", passRun.runId, "--json",
    ], repoRoot);
    assert(noFinalizeApproval.status === 1, "finalization requires explicit approval");
    const finalizedResult = runNode(cewpCli, [
      "workflow", "finalize", passRun.runId, "--yes", "--json",
    ], repoRoot);
    assert(finalizedResult.status === 0, `reviewed run finalizes: ${finalizedResult.stderr}`);
    const finalized = JSON.parse(finalizedResult.stdout).data;
    assert(finalized.run.status === "finalized", "explicit finalize reaches the terminal state");
    assert(finalized.run.reviewer.status === "passed", "finalization retains reviewer evidence");
    assert(finalized.progress.status === "finalized", "derived progress reflects finalization");
    assert(finalized.run.budget.consumed.allocations.finalization === 0, "local finalization does not fabricate a model operation");

    const outputRun = createReviewPendingRun(repoRoot);
    const oversizedReview = reviewResult(outputRun);
    oversizedReview.usage.capturedOutputBytes.value = outputRun.budget.maxCapturedOutputBytes + 1;
    writeJson(path.join(repoRoot, "oversized-review.json"), oversizedReview);
    const outputRefusal = runNode(cewpCli, [
      "workflow", "review", outputRun.runId,
      "--result", "oversized-review.json", "--yes", "--json",
    ], repoRoot);
    assert(outputRefusal.status === 1, "review output above the approved ceiling is rejected");
    assert(outputRefusal.stderr.includes("captured-output ceiling"), "review output refusal names the exhausted resource");
    const outputPaused = JSON.parse(runNode(cewpCli, [
      "workflow", "status", outputRun.runId, "--json",
    ], repoRoot).stdout).data.run;
    assert(outputPaused.status === "paused-budget-safe", "review output exhaustion pauses after verified checkpoints");
    assert(outputPaused.budget.pauseReason === "captured-output-budget-exhausted", "review output pause reason is canonical");
    assert(outputPaused.reviewer.status === "pending", "rejected review never opens the reviewer gate");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "workflow-runs", outputRun.runId, "reviews", `${oversizedReview.reviewId}.json`)), "rejected review result is not persisted");

    const changesRun = createReviewPendingRun(repoRoot);
    writeJson(path.join(repoRoot, "changes-review.json"), reviewResult(changesRun, "REQUEST_CHANGES"));
    const changesResult = runNode(cewpCli, [
      "workflow", "review", changesRun.runId,
      "--result", "changes-review.json",
      "--yes", "--json",
    ], repoRoot);
    assert(changesResult.status === 1, "REQUEST_CHANGES closes CLI success");
    assert(changesResult.stdout.trim().startsWith("{"), "REQUEST_CHANGES still returns structured recovery state");
    const changes = JSON.parse(changesResult.stdout).data;
    assert(changes.run.status === "blocked", "REQUEST_CHANGES is never represented as success");
    assert(changes.run.reviewer.status === "changes-requested", "review decision remains canonical");
    assert(changes.progress.nextAction.kind === "intervention", "blocked review exposes a recovery action");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowReviewContract();
  console.log("[PASS] workflow review and finalization require independent PASS");
} catch (error) {
  console.error("[FAIL] workflow review/finalization contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
