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
    assert(verified.data.run.tasks[0].verification.runs.length === 2, "post-change targeted evidence follows baseline");
    assert(verified.data.run.tasks[0].verification.runs[1].stage === "targeted", "post-change result is targeted");
    assert(verified.data.run.tasks[0].verification.runs[1].status === "pass", "targeted verification passes");
    assert(verified.data.run.budget.consumed.targetedVerificationRuns === 2, "local verification count is separate from model operations");
    assert(verified.data.run.budget.consumed.modelOperations === 1, "local checks do not inflate model-operation usage");
    assert(verified.data.nextAction.command.includes("supervise review"), "verified checkpoint requires independent review");
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
