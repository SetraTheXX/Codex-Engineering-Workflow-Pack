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
const { successfulResult } = require("./workflow-result");
const { approveWorkflow } = require("./workflow-scheduler");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function runCheckpointReviewContract() {
  const repoRoot = makeTempRepo("cewp-workflow-checkpoint-review-");
  try {
    const definition = validDefinition();
    definition.workflowId = "checkpoint-reviewed-change";
    definition.tasks = [definition.tasks[0]];
    definition.checkpointPolicy.reviewerAfterEachTask = true;
    definition.reviewerPolicy.requiredForFinalize = false;
    definition.budget.maxTargetedVerificationRuns = 6;
    definition.budget.maxFullVerificationRuns = 0;
    const run = approveWorkflow(repoRoot, definition);
    const started = JSON.parse(runNode(cewpCli, [
      "workflow", "start", run.runId,
      "--task", "implement-example", "--yes", "--json",
    ], repoRoot).stdout).data;
    const taskResult = successfulResult(run, started.checkpoint, [{
      command: "node --test tests/example.test.js",
      status: "passed",
      evidencePath: "evidence/targeted.json",
    }]);
    taskResult.completedAt = new Date(Date.now() + 1000).toISOString();
    writeJson(path.join(repoRoot, "checkpoint-result.json"), taskResult);
    const result = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "checkpoint-result.json", "--yes", "--json",
    ], repoRoot);
    assert(result.status === 0, `checkpoint result records before review: ${result.stderr}`);
    const pending = JSON.parse(result.stdout).data;
    assert(pending.run.status === "active", "checkpoint review does not open workflow completion");
    assert(pending.run.tasks[0].status === "review-pending", "verified task waits for its configured reviewer");
    assert(pending.run.tasks[0].activeCheckpointId === started.checkpoint.checkpointId, "review-pending task retains its checkpoint identity");
    assert(pending.checkpoint.status === "verified" && pending.checkpoint.reviewer.status === "pending", "checkpoint retains verification and reviewer gate state");
    assert(pending.progress.summary.completed === 0, "derived progress cannot count unreviewed task completion");
    assert(pending.progress.nextAction.kind === "checkpoint-review", "progress exposes the checkpoint review as next safe action");

    const review = {
      schemaVersion: "review-result/v1",
      reviewId: `${run.runId}-checkpoint-pass`,
      runId: run.runId,
      workflowDigest: run.workflow.digest,
      scope: {
        kind: "checkpoint",
        taskId: "implement-example",
        checkpointId: started.checkpoint.checkpointId,
      },
      completedAt: new Date(Date.now() + 2000).toISOString(),
      independent: true,
      decision: "PASS",
      summary: "Independent checkpoint review passed",
      findings: [],
      evidence: [{ kind: "checkpoint-review", path: "evidence/checkpoint-review.md" }],
      usage: {
        managedOperations: { label: "observed", value: 1, source: "fake-review-jsonl" },
        capturedOutputBytes: { label: "observed", value: 64, source: "fake-bounded-output" },
        managedTokens: { label: "unknown", value: null, reason: "fixture omits tokens" },
        hostInternal: { label: "unknown", value: null, reason: "fixture has no host usage" },
      },
    };
    const wrongScopeReview = {
      ...review,
      reviewId: `${run.runId}-checkpoint-wrong-scope`,
      scope: {
        ...review.scope,
        checkpointId: `${review.scope.checkpointId}-wrong`,
      },
    };
    writeJson(path.join(repoRoot, "wrong-scope-checkpoint-review.json"), wrongScopeReview);
    const wrongScopeResult = runNode(cewpCli, [
      "workflow", "review", run.runId,
      "--result", "wrong-scope-checkpoint-review.json", "--yes", "--json",
    ], repoRoot);
    assert(wrongScopeResult.status === 1, "review bound to another checkpoint is rejected");
    assert(wrongScopeResult.stderr.includes("scope does not match"), "wrong-scope refusal explains the checkpoint binding");
    const afterWrongScope = JSON.parse(runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot).stdout).data.run;
    assert(afterWrongScope.tasks[0].status === "review-pending", "rejected scope cannot mutate canonical task state");
    assert(afterWrongScope.budget.consumed.allocations.reviewer === 0, "rejected scope cannot consume reviewer allocation");

    const staleReview = {
      ...review,
      reviewId: `${run.runId}-checkpoint-stale`,
      completedAt: new Date(Date.parse(taskResult.completedAt) - 1000).toISOString(),
    };
    writeJson(path.join(repoRoot, "stale-checkpoint-review.json"), staleReview);
    const staleResult = runNode(cewpCli, [
      "workflow", "review", run.runId,
      "--result", "stale-checkpoint-review.json", "--yes", "--json",
    ], repoRoot);
    assert(staleResult.status === 1, "review evidence older than checkpoint verification is rejected");
    assert(staleResult.stderr.includes("after checkpoint verification"), "stale review refusal explains temporal evidence order");

    writeJson(path.join(repoRoot, "checkpoint-review.json"), review);
    const reviewedResult = runNode(cewpCli, [
      "workflow", "review", run.runId,
      "--result", "checkpoint-review.json", "--yes", "--json",
    ], repoRoot);
    assert(reviewedResult.status === 0, `checkpoint reviewer PASS records: ${reviewedResult.stderr}`);
    const reviewed = JSON.parse(reviewedResult.stdout).data;
    assert(reviewed.review.scope.kind === "checkpoint", "review evidence retains checkpoint scope");
    assert(reviewed.run.tasks[0].status === "completed" && reviewed.run.tasks[0].activeCheckpointId === null, "checkpoint PASS completes and releases the task");
    assert(reviewed.checkpoint.reviewer.status === "passed", "checkpoint reviewer PASS is canonical checkpoint state");
    assert(reviewed.run.status === "completed", "no-final-review workflow reaches completion only after checkpoint PASS");
    assert(reviewed.run.budget.consumed.allocations.reviewer === 1, "checkpoint review consumes protected reviewer allocation");
    assert(reviewed.run.budget.consumed.capturedOutputBytes === 320, "checkpoint review output joins canonical accounting");
    assert(reviewed.progress.nextAction.kind === "finalize", "reviewed workflow exposes explicit finalization");
  } finally {
    cleanupRepo(repoRoot);
  }
}

function runCheckpointReviewBlockContract() {
  const repoRoot = makeTempRepo("cewp-workflow-checkpoint-review-block-");
  try {
    const definition = validDefinition();
    definition.workflowId = "checkpoint-review-changes";
    definition.tasks = [definition.tasks[0]];
    definition.checkpointPolicy.reviewerAfterEachTask = true;
    definition.reviewerPolicy.requiredForFinalize = false;
    definition.budget.maxTargetedVerificationRuns = 6;
    definition.budget.maxFullVerificationRuns = 0;
    const run = approveWorkflow(repoRoot, definition);
    const started = JSON.parse(runNode(cewpCli, [
      "workflow", "start", run.runId,
      "--task", "implement-example", "--yes", "--json",
    ], repoRoot).stdout).data;
    const taskResult = successfulResult(run, started.checkpoint, [{
      command: "node --test tests/example.test.js",
      status: "passed",
      evidencePath: "evidence/targeted.json",
    }]);
    taskResult.completedAt = new Date(Date.now() + 1000).toISOString();
    writeJson(path.join(repoRoot, "blocked-checkpoint-result.json"), taskResult);
    const recorded = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "blocked-checkpoint-result.json", "--yes", "--json",
    ], repoRoot);
    assert(recorded.status === 0, `blocked-review fixture records verification: ${recorded.stderr}`);

    const review = {
      schemaVersion: "review-result/v1",
      reviewId: `${run.runId}-checkpoint-changes`,
      runId: run.runId,
      workflowDigest: run.workflow.digest,
      scope: {
        kind: "checkpoint",
        taskId: "implement-example",
        checkpointId: started.checkpoint.checkpointId,
      },
      completedAt: new Date(Date.now() + 2000).toISOString(),
      independent: true,
      decision: "REQUEST_CHANGES",
      summary: "Independent checkpoint review found a regression",
      findings: [{
        taskId: "implement-example",
        classification: "new-regression",
        severity: "high",
        summary: "The checkpoint needs a bounded correction.",
        evidencePaths: ["evidence/checkpoint-finding.json"],
      }],
      evidence: [{ kind: "checkpoint-review", path: "evidence/checkpoint-review.md" }],
      usage: {
        managedOperations: { label: "observed", value: 1, source: "fake-review-jsonl" },
        capturedOutputBytes: { label: "observed", value: 64, source: "fake-bounded-output" },
        managedTokens: { label: "unknown", value: null, reason: "fixture omits tokens" },
        hostInternal: { label: "unknown", value: null, reason: "fixture has no host usage" },
      },
    };
    writeJson(path.join(repoRoot, "changes-checkpoint-review.json"), review);
    const changesResult = runNode(cewpCli, [
      "workflow", "review", run.runId,
      "--result", "changes-checkpoint-review.json", "--yes", "--json",
    ], repoRoot);
    assert(changesResult.status === 1, "checkpoint REQUEST_CHANGES closes CLI success");
    assert(changesResult.stdout.trim().startsWith("{"), "blocked checkpoint review returns structured recovery state");
    const changes = JSON.parse(changesResult.stdout).data;
    assert(changes.run.status === "blocked", "checkpoint REQUEST_CHANGES blocks the workflow");
    assert(changes.run.tasks[0].status === "blocked", "checkpoint REQUEST_CHANGES blocks the scoped task");
    assert(changes.run.tasks[0].blocker.source === "independent-checkpoint-review", "task blocker retains independent review provenance");
    assert(changes.checkpoint.status === "blocked", "checkpoint REQUEST_CHANGES cannot remain verified");
    assert(changes.checkpoint.reviewer.status === "changes-requested", "checkpoint retains the reviewer decision");
    assert(changes.run.budget.consumed.allocations.reviewer === 1, "blocking review still accounts for reviewer usage");
    assert(changes.progress.nextAction.kind === "intervention", "blocked checkpoint exposes explicit recovery");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runCheckpointReviewContract();
  runCheckpointReviewBlockContract();
  console.log("[PASS] configured checkpoint review blocks task completion");
} catch (error) {
  console.error("[FAIL] workflow checkpoint review contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
