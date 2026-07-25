"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  createFakeCodexAdapter,
  FAKE_ADAPTER_MODES,
} = require("../harness/lib/fake-adapter");
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

function runNativeOwnershipConflictContract() {
  const repoRoot = makeTempRepo("cewp-supervised-native-conflict-");
  const fake = createFakeCodexAdapter();
  try {
    const runId = createApprovedRun(repoRoot);
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture grants worker authority");
    const runPath = path.join(repoRoot, ".cewp", "supervised-runs", runId, "run.json");
    const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
    const taskId = run.tasks[0].id;
    const targetWorktree = path.resolve(
      repoRoot,
      "..",
      ".cewp-worktrees",
      path.basename(repoRoot),
      runId,
      taskId,
    );
    const nativeOwnershipPath = path.join(
      repoRoot,
      ".cewp",
      "workflow-runs",
      "native-owner",
      "integration",
      "ownership.json",
    );
    fs.mkdirSync(path.dirname(nativeOwnershipPath), { recursive: true });
    fs.writeFileSync(nativeOwnershipPath, `${JSON.stringify({
      schemaVersion: "execution-ownership/v1",
      runId: "native-owner",
      taskId,
      checkpointId: `${taskId}-attempt-0001`,
      owner: "native",
      backend: null,
      status: "active",
      createdAt: "2026-07-18T12:00:00.000Z",
      cleanupAuthority: "host-owner",
      worktree: { id: `${runId}:${taskId}`, path: targetWorktree },
    }, null, 2)}\n`);

    const result = runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, { env: fake.env });
    assert(result.status === 1, "managed dispatch rejects a native-owned task worktree");
    assert(result.stderr.includes("execution-ownership-conflict"), "ownership refusal is actionable");
    assert(!fs.existsSync(targetWorktree), "conflicting managed worktree is not created");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

function runUnignoredCewpRuntimeContract() {
  const repoRoot = makeTempRepo("cewp-supervised-runtime-clean-");
  const fake = createFakeCodexAdapter();
  try {
    const gitignorePath = path.join(repoRoot, ".gitignore");
    const gitignore = fs.readFileSync(gitignorePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line !== ".cewp/")
      .join("\n");
    fs.writeFileSync(gitignorePath, gitignore);
    const committed = require("node:child_process").spawnSync("git", [
      "add", ".gitignore",
    ], { cwd: repoRoot, encoding: "utf8", shell: false });
    assert(committed.status === 0, `fixture stages .gitignore: ${committed.stderr}`);
    const commit = require("node:child_process").spawnSync("git", [
      "commit", "-m", "test: expose CEWP runtime state",
    ], { cwd: repoRoot, encoding: "utf8", shell: false });
    assert(commit.status === 0, `fixture commits .gitignore: ${commit.stderr}`);

    const runId = createApprovedRun(repoRoot);
    const status = require("node:child_process").spawnSync("git", [
      "status", "--porcelain", "--untracked-files=all",
    ], { cwd: repoRoot, encoding: "utf8", shell: false });
    assert(status.status === 0 && status.stdout.includes("?? .cewp/"), "fixture exposes only CEWP-owned untracked runtime state");
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture grants worker authority");

    const executed = runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, { env: fake.env });
    assert(executed.status === 0, `CEWP-owned untracked .cewp runtime state does not dirty the source repo: ${executed.stderr}`);
    assert(JSON.parse(executed.stdout).data.run.status === "verifying", "runtime-only source state still reaches the verification gate");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

function runTrackedCewpMutationContract() {
  const repoRoot = makeTempRepo("cewp-supervised-runtime-tracked-");
  const fake = createFakeCodexAdapter();
  try {
    const markerPath = path.join(repoRoot, ".cewp", "tracked-marker.txt");
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, "committed\n");
    const git = require("node:child_process");
    assert(git.spawnSync("git", ["add", "-f", ".cewp/tracked-marker.txt"], {
      cwd: repoRoot, encoding: "utf8", shell: false,
    }).status === 0, "fixture stages the intentional tracked CEWP marker");
    assert(git.spawnSync("git", ["commit", "-m", "test: track CEWP marker"], {
      cwd: repoRoot, encoding: "utf8", shell: false,
    }).status === 0, "fixture commits the intentional tracked CEWP marker");

    const runId = createApprovedRun(repoRoot);
    fs.writeFileSync(markerPath, "modified\n");
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture grants worker authority");
    const executed = runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, { env: fake.env });
    assert(executed.status === 1, "tracked .cewp changes still make the source repository dirty");
    assert(executed.stderr.includes("source repository is dirty"), "tracked .cewp refusal remains fail-closed");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

function runCodexModelIncompatibilityContract() {
  const repoRoot = makeTempRepo("cewp-supervised-model-incompatible-");
  const fake = createFakeCodexAdapter(FAKE_ADAPTER_MODES.MODEL_INCOMPATIBLE);
  try {
    const runId = createApprovedRun(repoRoot);
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture grants worker authority");
    const executed = runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, { env: fake.env });
    assert(executed.status === 1, "incompatible Codex host blocks managed dispatch");
    const response = JSON.parse(executed.stdout);
    const run = response.data.run;
    const task = run.tasks[0];
    assert(run.status === "blocked" && task.status === "blocked", "host incompatibility remains fail-closed");
    assert(task.blocker.code === "codex-cli-model-incompatible", "structured host failure receives a specific blocker code");
    assert(
      task.blocker.reasons.some((reason) => reason.includes("requires a newer version of Codex")),
      "blocker retains the host's actionable failure",
    );
    assert(
      !task.blocker.reasons.includes("codex-exec last message is missing"),
      "missing last-message noise does not hide a structured host failure",
    );
    assert(
      task.blocker.remediation.some((action) => action.includes("Upgrade the Codex app or CLI")),
      "blocker tells the operator how to restore host compatibility",
    );
    assert(task.blocker.automaticChanges === false, "CEWP records that it did not reroute the model or alter host configuration");
    assert(task.attempts[0].changedFiles.length === 0, "failed host startup makes no repository changes");
    assert(run.usage.managedTokens.label === "unknown", "missing usage remains unknown rather than zero");
    assert(
      run.reviewer.status === "pending" && run.reviewer.decision === null,
      "host failure cannot bypass the reviewer gate",
    );
    const progress = fs.readFileSync(
      path.join(repoRoot, ".cewp", "supervised-runs", runId, "progress.md"),
      "utf8",
    );
    assert(progress.includes("Upgrade the Codex app or CLI"), "operator progress renders remediation");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
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
  runNativeOwnershipConflictContract();
  runUnignoredCewpRuntimeContract();
  runTrackedCewpMutationContract();
  runCodexModelIncompatibilityContract();
  runSupervisedExecutionContract();
  console.log("[PASS] supervised dispatch preserves ownership, scope, and usage truth");
} catch (error) {
  console.error("[FAIL] supervised execution contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
