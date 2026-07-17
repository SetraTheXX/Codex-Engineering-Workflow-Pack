"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { createFakeCodexAdapter } = require("../harness/lib/fake-adapter");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
} = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function parseJson(result, label) {
  assert(result.status === 0, `${label} failed: ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}\n${result.stdout}`);
  }
}

function createApprovedRun(repoRoot) {
  const planned = parseJson(runNode(cewpCli, [
    "supervise",
    "plan",
    "--goal",
    "Update the bounded README section",
    "--scope",
    "README.md",
    "--verify",
    "git diff --check",
    "--full-verify",
    "git status --short",
    "--stop",
    "README change passes the targeted check",
    "--json",
  ], repoRoot), "supervise plan");
  const runId = planned.data.run.runId;
  parseJson(runNode(cewpCli, [
    "supervise",
    "approve",
    runId,
    "--yes",
    "--json",
  ], repoRoot), "supervise approve");
  return runId;
}

function runSupervisedExecutionContract() {
  const repoRoot = makeTempRepo("cewp-supervised-exec-");
  const fake = createFakeCodexAdapter();

  try {
    const runId = createApprovedRun(repoRoot);
    const policyBlocked = runNode(cewpCli, [
      "supervise",
      "execute",
      runId,
      "--yes",
      "--json",
    ], repoRoot, { env: fake.env });
    assert(policyBlocked.status === 1, "safe operator policy blocks managed execution");
    assert(policyBlocked.stderr.includes("operator policy blocks dispatch worker execution"), "policy refusal is actionable");
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture explicitly grants worker authority");

    const executed = parseJson(runNode(cewpCli, [
      "supervise",
      "execute",
      runId,
      "--yes",
      "--timeout",
      "20",
      "--json",
    ], repoRoot, { env: fake.env }), "supervise execute");

    assert(executed.command === "supervise.execute", "execution output identifies the command");
    const run = executed.data.run;
    const task = run.tasks[0];
    assert(run.status === "verifying", "successful dispatch waits for local verification");
    assert(task.status === "awaiting-verification", "checkpoint cannot advance after dispatch alone");
    assert(task.attempts.length === 1 && task.attempts[0].status === "completed", "dispatch attempt is canonical state");
    assert(task.attempts[0].changedFiles.includes("README.md"), "post-execution scope evidence is captured");
    assert(run.budget.consumed.modelOperations === 1, "operation is consumed when dispatch starts");
    assert(run.budget.consumed.allocations.implementation === 1, "worker uses only implementation allocation");
    assert(run.usage.managedOperations.value === 1, "managed operation count is observed");
    assert(run.usage.managedTokens.label === "observed", "structured Codex usage becomes observed");
    assert(run.usage.managedTokens.inputTokens === 100, "input token category is retained");
    assert(run.usage.managedTokens.cachedInputTokens === 80, "cached input category is retained without subtraction");
    assert(run.usage.managedTokens.outputTokens === 20, "output token category is retained");
    assert(run.usage.managedTokens.reasoningOutputTokens === 5, "reasoning category is retained");
    assert(run.usage.hostInternal.label === "unknown", "managed usage does not imply host-internal usage");
    assert(task.verification.runs.length === 1, "pre-change baseline is captured before dispatch");
    assert(task.verification.runs[0].stage === "baseline", "baseline evidence is labeled");

    const ownershipPath = path.join(repoRoot, ".cewp", "supervised-runs", runId, "ownership.json");
    const ownership = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
    assert(ownership.schemaVersion === "execution-ownership/v1", "ownership contract is persisted before dispatch");
    assert(ownership.owner === "managed" && ownership.backend === "codex-exec", "one owner/backend pair owns the checkpoint");
    assert(path.resolve(ownership.worktree.path) !== path.resolve(repoRoot), "worker uses a distinct CEWP worktree");

    const partialPause = parseJson(runNode(cewpCli, [
      "supervise", "pause", runId,
      "--reason", "budget-unverified",
      "--yes", "--json",
    ], repoRoot), "pause partial checkpoint");
    assert(partialPause.data.run.status === "paused-budget-unverified", "partial isolated work pauses as unverified");
    assert(partialPause.data.run.tasks[0].status === "awaiting-verification", "pause cannot turn partial work into PASS");
    const partialFinalize = runNode(cewpCli, [
      "supervise", "finalize", runId, "--yes", "--json",
    ], repoRoot);
    assert(partialFinalize.status === 1, "unverified pause cannot finalize");
    const partialResume = parseJson(runNode(cewpCli, [
      "supervise", "resume", runId, "--yes", "--json",
    ], repoRoot), "resume partial checkpoint");
    assert(partialResume.data.run.status === "verifying", "partial pause resumes at verification, not dispatch");

    const repeated = runNode(cewpCli, [
      "supervise",
      "execute",
      runId,
      "--yes",
      "--json",
    ], repoRoot, { env: fake.env });
    assert(repeated.status === 1, "the same ready checkpoint cannot be dispatched twice");
    assert(repeated.stderr.includes("awaiting-verification"), "repeat refusal reports canonical checkpoint state");

    const verified = parseJson(runNode(cewpCli, [
      "supervise",
      "verify",
      runId,
      "--json",
    ], repoRoot), "supervise verify");
    assert(verified.command === "supervise.verify", "verification output identifies the command");
    assert(verified.data.run.status === "checkpoint-complete", "passing local checks close the checkpoint");
    assert(verified.data.run.tasks[0].status === "verified", "checkpoint advances only after verification");
    assert(verified.data.run.tasks[0].verification.runs.length === 3, "targeted and full evidence follow baseline");
    assert(verified.data.run.tasks[0].verification.runs[1].stage === "targeted", "post-change result is targeted");
    assert(verified.data.run.tasks[0].verification.runs[1].status === "pass", "targeted verification passes");
    assert(verified.data.run.tasks[0].verification.runs[2].stage === "full", "broad verification runs only after targeted PASS");
    assert(verified.data.run.tasks[0].verification.runs[2].status === "pass", "broad verification passes");
    assert(verified.data.run.budget.consumed.targetedVerificationRuns === 2, "local verification count is separate from model operations");
    assert(verified.data.run.budget.consumed.fullVerificationRuns === 1, "full verification has a separate counter");
    assert(verified.data.run.budget.consumed.modelOperations === 1, "local checks do not inflate model-operation usage");
    assert(verified.data.nextAction.command.includes("supervise review"), "verified checkpoint requires independent review");
    const verifiedProgress = fs.readFileSync(path.join(repoRoot, ".cewp", "supervised-runs", runId, "progress.md"), "utf8");
    assert(verifiedProgress.includes("## Attempts"), "generated progress renders attempt details");
    assert(verifiedProgress.includes("implementation / completed"), "generated progress identifies the implementation attempt");
    assert(verifiedProgress.includes("## Evidence"), "generated progress renders completed evidence");
    assert(verifiedProgress.includes("verification: targeted-1, full-1"), "generated progress names verified evidence ids");
    assert(verifiedProgress.includes("Model operations: observed 1 / budgeted 10"), "generated progress separates observed consumption from budgeted ceiling");
    assert(verifiedProgress.includes("Host-internal usage: unknown"), "generated progress keeps unavailable host usage unknown");

    const continued = parseJson(runNode(cewpCli, [
      "supervise", "continue", runId, "--json",
    ], repoRoot), "continue after checkpoint");
    assert(continued.data.run.status === "checkpoint-complete", "continue preserves verified checkpoint state");
    assert(continued.data.nextAction.command.includes("supervise review"), "single-checkpoint continue advances to review");

    const prematureFinalize = runNode(cewpCli, [
      "supervise", "finalize", runId, "--yes", "--json",
    ], repoRoot);
    assert(prematureFinalize.status === 1, "finalize cannot bypass independent review");
    assert(prematureFinalize.stderr.includes("reviewer PASS"), "finalize refusal names the reviewer gate");

    const reviewed = parseJson(runNode(cewpCli, [
      "supervise", "review", runId, "--yes", "--json",
    ], repoRoot, { env: fake.env }), "supervise review");
    assert(reviewed.command === "supervise.review", "review output identifies the command");
    assert(reviewed.data.run.status === "review-passed", "explicit reviewer PASS opens receipt preview");
    assert(reviewed.data.run.reviewer.decision === "PASS", "reviewer decision is canonical state");
    assert(reviewed.data.run.budget.consumed.allocations.reviewer === 1, "review consumes only protected reviewer allocation");
    assert(reviewed.data.run.budget.consumed.allocations.finalization === 0, "review cannot borrow finalization allocation");
    assert(reviewed.data.run.usage.managedOperations.value === 2, "reviewer is a separate observed model operation");

    const receipt = parseJson(runNode(cewpCli, [
      "supervise", "receipt", runId, "--json",
    ], repoRoot), "supervise receipt");
    assert(receipt.command === "supervise.receipt", "receipt output identifies the command");
    assert(receipt.data.receipt.schemaVersion === "supervised-receipt/v1-beta", "receipt preview is versioned");
    assert(receipt.data.receipt.finalizable === true, "receipt proves finalization gates are open");
    assert(receipt.data.receipt.usage.hostInternal.label === "unknown", "receipt does not turn unavailable host usage into zero");
    assert(receipt.data.receipt.managedModelOperations.label === "observed", "receipt labels managed operations as observed");
    assert(receipt.data.receipt.budget.modelOperations.label === "budgeted", "receipt labels the ceiling as budgeted");
    assert(receipt.data.receipt.usage.estimate.label === "unknown", "receipt does not fabricate an uncalibrated estimate");
    assert(receipt.data.receipt.usage.estimate.sampleCount === 0, "receipt retains estimate sample basis");
    assert(receipt.data.receipt.usage.currency.label === "unknown", "subscription usage does not receive fabricated currency");
    const receiptMarkdown = fs.readFileSync(path.join(repoRoot, ".cewp", "supervised-runs", runId, "receipt-preview.md"), "utf8");
    assert(receiptMarkdown.includes("Observed managed model operations: 2"), "human receipt shows observed managed operations");
    assert(receiptMarkdown.includes("Budgeted model-operation ceiling: 10"), "human receipt shows budgeted ceiling separately");
    assert(receiptMarkdown.includes("Estimated managed usage: unknown"), "human receipt labels unavailable estimate");
    assert(receiptMarkdown.includes("Estimate basis: 0 comparable local runs"), "human receipt shows estimate sample basis");
    assert(receipt.data.run.status === "ready-to-finalize", "explicit receipt preview precedes finalize");

    const finalized = parseJson(runNode(cewpCli, [
      "supervise", "finalize", runId, "--yes", "--json",
    ], repoRoot), "supervise finalize");
    assert(finalized.command === "supervise.finalize", "finalize output identifies the command");
    assert(finalized.data.run.status === "completed", "explicit finalize closes canonical state");
    assert(finalized.data.run.tasks[0].status === "completed", "verified checkpoint becomes complete only at finalize");
    const releasedOwnership = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
    assert(releasedOwnership.status === "released", "finalize releases execution ownership");
    assert(finalized.data.run.budget.consumed.allocations.implementation === 1, "closing stages do not consume worker allocation");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

try {
  runSupervisedExecutionContract();
  console.log("[PASS] supervised dispatch preserves ownership, scope, and usage truth");
} catch (error) {
  console.error("[FAIL] supervised execution contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
