"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  readJson,
  runNode,
  writeFile,
  writeJson,
} = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { successfulResult } = require("./workflow-result");
const { approveWorkflow } = require("./workflow-scheduler");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function completeFirstTask(repoRoot, run) {
  const startedResult = runNode(cewpCli, [
    "workflow", "start", run.runId,
    "--task", "implement-example", "--yes", "--json",
  ], repoRoot);
  assert(startedResult.status === 0, `revision fixture starts: ${startedResult.stderr}`);
  const checkpoint = JSON.parse(startedResult.stdout).data.checkpoint;
  writeJson(path.join(repoRoot, "completed-task-result.json"), successfulResult(run, checkpoint, [{
    command: "node --test tests/example.test.js",
    status: "passed",
    evidencePath: "evidence/targeted.json",
  }]));
  const result = runNode(cewpCli, [
    "workflow", "result", run.runId,
    "--task", "implement-example",
    "--result", "completed-task-result.json",
    "--yes", "--json",
  ], repoRoot);
  assert(result.status === 0, `revision fixture records result: ${result.stderr}`);
  return JSON.parse(result.stdout).data.run;
}

function revisionTwo(run) {
  const definition = validDefinition();
  definition.revision = {
    number: 2,
    parent: run.workflow.digest,
    reason: "Split the remaining documentation and release-note work",
  };
  definition.tasks[1].title = "Document the revised verified example";
  definition.tasks.push({
    id: "release-note",
    title: "Record the bounded user-facing outcome",
    dependsOn: ["document-example"],
    allowedFiles: ["CHANGELOG.md"],
    forbiddenFiles: ["package.json"],
    stoppingConditions: ["The release-note diff passes whitespace validation"],
    verification: {
      targeted: ["git diff --check"],
      full: [],
    },
    risk: "low",
  });
  return definition;
}

function runWorkflowRevisionContract() {
  const repoRoot = makeTempRepo("cewp-workflow-revision-");
  try {
    const run = approveWorkflow(repoRoot, validDefinition());
    const beforeRevision = completeFirstTask(repoRoot, run);
    const completedBefore = beforeRevision.tasks.find((task) => task.id === "implement-example");
    const runRoot = path.join(repoRoot, ".cewp", "workflow-runs", run.runId);
    const revisionsRoot = path.join(repoRoot, ".cewp", "workflows", run.workflow.id, "definitions");
    const proposal = revisionTwo(run);
    writeJson(path.join(repoRoot, "revision-2.json"), proposal);
    writeFile(path.join(repoRoot, "revision-plan.md"), "# Revision plan\n\nSplit the remaining release work.\n");

    const previewResult = runNode(cewpCli, [
      "workflow", "revise", run.runId,
      "--proposal", "revision-2.json",
      "--from", "revision-plan.md", "--json",
    ], repoRoot);
    assert(previewResult.status === 0, `revision preview succeeds: ${previewResult.stderr}`);
    const preview = JSON.parse(previewResult.stdout);
    assert(preview.command === "workflow.revise", "revision preview identifies the command");
    assert(preview.data.diff.baseRevision === 1 && preview.data.diff.proposedRevision === 2, "preview compares adjacent revisions");
    assert(preview.data.diff.addedTasks.includes("release-note"), "preview identifies added work");
    assert(preview.data.diff.changedTasks.includes("document-example"), "preview identifies changed remaining work");
    assert(preview.data.definitionDigest.startsWith("sha256:"), "revision preview separates immutable definition identity");
    assert(readJson(path.join(runRoot, "run.json")).workflow.revision === 1, "preview never mutates canonical state");
    assert(!fs.existsSync(path.join(revisionsRoot, "revision-000002.json")), "preview does not persist the proposal");
    assert(!fs.existsSync(path.join(runRoot, "backups")), "preview does not create a backup");

    const changedCompleted = revisionTwo(run);
    changedCompleted.tasks[0].title = "Rewrite already completed work";
    writeJson(path.join(repoRoot, "changed-completed.json"), changedCompleted);
    const rejectedCompleted = runNode(cewpCli, [
      "workflow", "revise", run.runId,
      "--proposal", "changed-completed.json", "--json",
    ], repoRoot);
    assert(rejectedCompleted.status === 1, "revision cannot rewrite a completed task definition");
    assert(rejectedCompleted.stderr.includes("completed task"), "completed-task refusal explains the evidence boundary");

    const changedOwnership = revisionTwo(run);
    changedOwnership.execution.owner = "native";
    changedOwnership.execution.backend = null;
    changedOwnership.execution.allowedModes = ["autonomous"];
    writeJson(path.join(repoRoot, "changed-ownership.json"), changedOwnership);
    const rejectedOwnership = runNode(cewpCli, [
      "workflow", "revise", run.runId,
      "--proposal", "changed-ownership.json", "--json",
    ], repoRoot);
    assert(rejectedOwnership.status === 1, "revision cannot switch execution ownership inside a run");
    assert(rejectedOwnership.stderr.includes("execution owner or backend"), "ownership refusal explains the boundary");

    const underConsumed = revisionTwo(run);
    underConsumed.budget.allocations.implementation = 0;
    underConsumed.budget.allocations.repair += 6;
    writeJson(path.join(repoRoot, "under-consumed-budget.json"), underConsumed);
    const rejectedBudget = runNode(cewpCli, [
      "workflow", "revise", run.runId,
      "--proposal", "under-consumed-budget.json", "--json",
    ], repoRoot);
    assert(rejectedBudget.status === 1, "revision budget cannot erase observed allocation use");
    assert(rejectedBudget.stderr.includes("observed consumption"), "budget refusal names historical consumption");

    const missingApproval = runNode(cewpCli, [
      "workflow", "apply-revision", run.runId,
      "--proposal", "revision-2.json",
      "--digest", preview.data.digest,
      "--json",
    ], repoRoot);
    assert(missingApproval.status === 1, "revision application requires explicit approval");

    const changedAfterPreview = revisionTwo(run);
    changedAfterPreview.tasks[1].title = "Proposal changed after digest preview";
    writeJson(path.join(repoRoot, "changed-after-preview.json"), changedAfterPreview);
    const staleDigest = runNode(cewpCli, [
      "workflow", "apply-revision", run.runId,
      "--proposal", "changed-after-preview.json",
      "--digest", preview.data.digest,
      "--yes", "--json",
    ], repoRoot);
    assert(staleDigest.status === 1, "changed proposal invalidates preview approval");
    assert(staleDigest.stderr.includes("changed after preview"), "digest refusal requests a fresh preview");

    writeFile(path.join(repoRoot, "revision-plan.md"), "# Changed revision plan\n\nThe revision source drifted after preview.\n");
    const staleSource = runNode(cewpCli, [
      "workflow", "apply-revision", run.runId,
      "--proposal", "revision-2.json",
      "--from", "revision-plan.md",
      "--digest", preview.data.digest,
      "--yes", "--json",
    ], repoRoot);
    assert(staleSource.status === 1, "changed revision source invalidates preview approval");
    assert(staleSource.stderr.includes("source or revision changed after preview"), "revision source refusal requests a fresh preview");
    assert(readJson(path.join(runRoot, "run.json")).workflow.revision === 1, "stale revision source never mutates canonical run state");
    assert(!fs.existsSync(path.join(revisionsRoot, "revision-000002.json")), "stale revision source never persists a definition");
    assert(!fs.existsSync(path.join(runRoot, "backups")), "stale revision source never creates a backup");
    writeFile(path.join(repoRoot, "revision-plan.md"), "# Revision plan\n\nSplit the remaining release work.\n");

    const appliedResult = runNode(cewpCli, [
      "workflow", "apply-revision", run.runId,
      "--proposal", "revision-2.json",
      "--from", "revision-plan.md",
      "--digest", preview.data.digest,
      "--yes", "--json",
    ], repoRoot);
    assert(appliedResult.status === 0, `approved revision applies: ${appliedResult.stderr}`);
    const applied = JSON.parse(appliedResult.stdout);
    assert(applied.command === "workflow.apply-revision", "revision application identifies the command");
    assert(applied.data.run.workflow.revision === 2, "run points to the approved new revision");
    assert(applied.data.run.workflow.digest === preview.data.definitionDigest, "run pins the previewed definition digest");
    assert(applied.data.run.approval.digest === preview.data.digest, "revision approval pins definition and source together");
    const completedAfter = applied.data.run.tasks.find((task) => task.id === "implement-example");
    assert(completedAfter.status === "completed", "completed task remains completed");
    assert(completedAfter.resultId === completedBefore.resultId, "completed result evidence is retained exactly");
    assert(completedAfter.verification.resultId === completedBefore.verification.resultId, "verification evidence link is retained exactly");
    assert(applied.data.run.tasks.find((task) => task.id === "document-example").status === "ready", "changed remaining task is schedulable after approval");
    assert(applied.data.run.tasks.find((task) => task.id === "release-note").status === "pending", "new dependency remains pending");
    assert(applied.data.run.revisionHistory.length === 1, "prior revision is recorded in canonical history");
    assert(applied.data.progress.workflow.revisionReason === proposal.revision.reason, "derived progress explains why the graph changed");
    assert(fs.existsSync(path.join(repoRoot, applied.data.backupPath)), "explicit revision creates a run backup");
    assert(fs.existsSync(path.join(revisionsRoot, "revision-000001.json")), "initial definition remains immutable");
    assert(fs.existsSync(path.join(revisionsRoot, "revision-000002.json")), "approved definition revision is persisted separately");

    const activeRun = approveWorkflow(repoRoot, { ...validDefinition(), workflowId: "active-revision-guard" });
    assert(runNode(cewpCli, [
      "workflow", "start", activeRun.runId,
      "--task", "implement-example", "--yes", "--json",
    ], repoRoot).status === 0, "active revision guard starts a checkpoint");
    const activeProposal = revisionTwo(activeRun);
    activeProposal.workflowId = "active-revision-guard";
    writeJson(path.join(repoRoot, "active-revision.json"), activeProposal);
    const activeRevision = runNode(cewpCli, [
      "workflow", "revise", activeRun.runId,
      "--proposal", "active-revision.json", "--json",
    ], repoRoot);
    assert(activeRevision.status === 1, "revision refuses an active unverified checkpoint");
    assert(activeRevision.stderr.includes("active checkpoint"), "active revision refusal names the safe checkpoint requirement");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowRevisionContract();
  console.log("[PASS] workflow revisions retain completed evidence and immutable history");
} catch (error) {
  console.error("[FAIL] workflow revision contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
