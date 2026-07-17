"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { createFakeCodexAdapter } = require("../harness/lib/fake-adapter");
const { evaluateOperationBudget } = require("../../src/supervise/budget");
const { makeBudgetEnvelope } = require("../../src/supervise/profiles");
const { cleanupRepo, makeTempRepo, runNode } = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function parseJson(result, label) {
  assert(result.status === 0, `${label} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function budgetRun(taskStatus = "verified") {
  return {
    createdAt: "2026-07-16T00:00:00.000Z",
    approval: { approvedAt: "2026-07-16T00:00:00.000Z" },
    budget: makeBudgetEnvelope("standard"),
    tasks: [{ status: taskStatus }],
  };
}

function runBudgetDecisionContract() {
  const safe = budgetRun("verified");
  safe.budget.consumed.modelOperations = 9;
  safe.budget.consumed.allocations.implementation = 6;
  safe.budget.consumed.allocations.repair = 2;
  safe.budget.consumed.allocations.finalization = 1;
  const reserveBlock = evaluateOperationBudget(safe, "implementation", {
    now: new Date("2026-07-16T00:10:00.000Z"),
  });
  assert(reserveBlock.allowed === false, "worker cannot start at reserve threshold");
  assert(reserveBlock.pauseStatus === "paused-budget-safe", "verified checkpoint pauses safely");

  const protectedReview = evaluateOperationBudget(safe, "reviewer", {
    now: new Date("2026-07-16T00:10:00.000Z"),
  });
  assert(protectedReview.allowed === true, "protected reviewer allocation remains usable before ceiling");

  const unverified = budgetRun("awaiting-verification");
  unverified.budget.consumed.modelOperations = 9;
  unverified.budget.consumed.allocations.implementation = 6;
  unverified.budget.consumed.allocations.repair = 2;
  unverified.budget.consumed.allocations.finalization = 1;
  const unverifiedBlock = evaluateOperationBudget(unverified, "implementation", {
    now: new Date("2026-07-16T00:10:00.000Z"),
  });
  assert(unverifiedBlock.pauseStatus === "paused-budget-unverified", "partial checkpoint remains explicitly unverified");

  const ceiling = budgetRun("verified");
  ceiling.budget.consumed.modelOperations = 10;
  const ceilingBlock = evaluateOperationBudget(ceiling, "reviewer", {
    now: new Date("2026-07-16T00:10:00.000Z"),
  });
  assert(ceilingBlock.allowed === false && ceilingBlock.reason === "absolute-ceiling-exhausted", "no operation starts beyond ceiling");

  const hostLimited = budgetRun("verified");
  hostLimited.budget.hostLimit = { active: true, source: "fixture" };
  const hostBlock = evaluateOperationBudget(hostLimited, "implementation", {
    now: new Date("2026-07-16T00:10:00.000Z"),
  });
  assert(hostBlock.pauseStatus === "paused-host-limit", "host limit remains separate from CEWP budget");

  const warning = budgetRun("ready");
  warning.budget.consumed.modelOperations = 7;
  const early = evaluateOperationBudget(warning, "repair", {
    now: new Date("2026-07-16T00:10:00.000Z"),
  });
  assert(early.allowed === true && early.warning === "budget-early-warning", "70 percent emits a non-bypassing warning");
}

function createPlan(repoRoot, goal) {
  return parseJson(runNode(cewpCli, [
    "supervise", "plan",
    "--goal", goal,
    "--scope", "README.md",
    "--verify", "git diff --check",
    "--stop", "The approved check passes",
    "--json",
  ], repoRoot), "plan").data.run.runId;
}

function runOperatorControlContract() {
  const repoRoot = makeTempRepo("cewp-supervised-controls-");
  try {
    const runId = createPlan(repoRoot, "Original bounded goal");
    parseJson(runNode(cewpCli, ["supervise", "approve", runId, "--yes", "--json"], repoRoot), "approve");

    const revised = parseJson(runNode(cewpCli, [
      "supervise", "revise", runId,
      "--goal", "Revised bounded goal",
      "--scope", "docs/install.md",
      "--verify", "git status --short",
      "--stop", "The revised check passes",
      "--json",
    ], repoRoot), "revise");
    assert(revised.data.run.planRevision === 2, "revision increments canonical plan version");
    assert(revised.data.run.status === "proposed", "revision requires fresh approval");
    assert(revised.data.run.approval === null, "old approval cannot authorize revised scope");
    assert(revised.data.run.tasks[0].allowedFiles[0] === "docs/install.md", "revised scope is canonical state");

    parseJson(runNode(cewpCli, ["supervise", "approve", runId, "--yes", "--json"], repoRoot), "reapprove");
    const paused = parseJson(runNode(cewpCli, [
      "supervise", "pause", runId, "--reason", "budget-safe", "--yes", "--json",
    ], repoRoot), "pause");
    assert(paused.data.run.status === "paused-budget-safe", "operator can record a safe budget pause");
    assert(paused.data.run.pause.actions.includes("add-budget"), "pause exposes recovery actions");

    const expanded = parseJson(runNode(cewpCli, [
      "supervise", "add-budget", runId,
      "--operations", "2",
      "--allocation", "implementation",
      "--yes", "--json",
    ], repoRoot), "add budget");
    assert(expanded.data.run.budget.modelOperations.value === 12, "explicit add-budget raises absolute ceiling");
    assert(expanded.data.run.budget.allocations.implementation.value === 8, "new operations stay in the selected allocation");
    const allocationTotal = Object.values(expanded.data.run.budget.allocations)
      .reduce((total, entry) => total + entry.value, 0);
    assert(allocationTotal === 12, "allocations still sum to approved ceiling");

    const resumed = parseJson(runNode(cewpCli, [
      "supervise", "resume", runId, "--yes", "--json",
    ], repoRoot), "resume");
    assert(resumed.data.run.status === "approved", "safe pause resumes at its prior checkpoint state");

    const hostPaused = parseJson(runNode(cewpCli, [
      "supervise", "pause", runId,
      "--reason", "host-limit", "--note", "fixture host window exhausted",
      "--yes", "--json",
    ], repoRoot), "host pause");
    assert(hostPaused.data.run.status === "paused-host-limit", "host exhaustion has a distinct pause state");
    assert(hostPaused.data.run.budget.hostLimit.active === true, "host-limit evidence is canonical state");
    const hostResumed = parseJson(runNode(cewpCli, [
      "supervise", "resume", runId, "--yes", "--json",
    ], repoRoot), "host resume");
    assert(hostResumed.data.run.status === "approved", "explicit host recovery returns to prior state");
    assert(hostResumed.data.run.budget.hostLimit === null, "resume explicitly clears stale host limit");

    const reassigned = parseJson(runNode(cewpCli, [
      "supervise", "reassign", runId, "--json",
    ], repoRoot), "reassign capability");
    assert(reassigned.data.supported === false, "Phase 9 reports reassign as unavailable instead of switching backend");
    assert(reassigned.data.run.execution.backend === "codex-exec", "unsupported reassign cannot change backend");

    const cancelId = createPlan(repoRoot, "Cancel this proposal");
    const cancelled = parseJson(runNode(cewpCli, [
      "supervise", "cancel", cancelId, "--yes", "--json",
    ], repoRoot), "cancel");
    assert(cancelled.data.run.status === "cancelled", "cancel is not represented as success");
    assert(cancelled.data.run.tasks[0].status === "cancelled", "cancelled checkpoint cannot execute");
  } finally {
    cleanupRepo(repoRoot);
  }
}

function createActiveRun(repoRoot, fake, goal) {
  const runId = createPlan(repoRoot, goal);
  parseJson(runNode(cewpCli, ["supervise", "approve", runId, "--yes", "--json"], repoRoot), "approve active run");
  const executed = parseJson(runNode(cewpCli, [
    "supervise", "execute", runId, "--yes", "--json",
  ], repoRoot, { env: fake.env }), "execute active run");
  return {
    runId,
    ownershipPath: path.join(repoRoot, ".cewp", "supervised-runs", runId, "ownership.json"),
    worktreePath: executed.data.ownership.worktree.path,
  };
}

function runManagedTerminationContract() {
  const repoRoot = makeTempRepo("cewp-supervised-terminal-controls-");
  const fake = createFakeCodexAdapter();
  try {
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture grants managed execution authority");

    const blockedRun = createActiveRun(repoRoot, fake, "Block and roll back this checkpoint");
    assert(fs.readFileSync(path.join(blockedRun.worktreePath, "README.md"), "utf8").includes("Fake Codex"), "fixture creates isolated partial work");
    const blocked = parseJson(runNode(cewpCli, [
      "supervise", "block", blockedRun.runId, "--reason", "operator review required", "--json",
    ], repoRoot), "block active run");
    assert(blocked.data.run.status === "blocked", "operator block closes PASS without abandoning ownership");
    assert(JSON.parse(fs.readFileSync(blockedRun.ownershipPath, "utf8")).status === "active", "blocked work remains owned for an explicit recovery action");

    const originalOwnership = JSON.parse(fs.readFileSync(blockedRun.ownershipPath, "utf8"));
    fs.writeFileSync(blockedRun.ownershipPath, `${JSON.stringify({ ...originalOwnership, runId: "different-run" }, null, 2)}\n`);
    const mismatchedOwnership = runNode(cewpCli, [
      "supervise", "rollback", blockedRun.runId, "--yes", "--json",
    ], repoRoot);
    assert(mismatchedOwnership.status === 1 && mismatchedOwnership.stderr.includes("does not match"), "rollback rejects mismatched canonical ownership identity");
    assert(fs.readFileSync(path.join(blockedRun.worktreePath, "README.md"), "utf8").includes("Fake Codex"), "ownership rejection occurs before worktree mutation");
    fs.writeFileSync(blockedRun.ownershipPath, `${JSON.stringify(originalOwnership, null, 2)}\n`);

    const rollbackWithoutApproval = runNode(cewpCli, [
      "supervise", "rollback", blockedRun.runId, "--json",
    ], repoRoot);
    assert(rollbackWithoutApproval.status === 1 && rollbackWithoutApproval.stderr.includes("--yes"), "rollback requires explicit operator approval");
    const rolledBack = parseJson(runNode(cewpCli, [
      "supervise", "rollback", blockedRun.runId, "--yes", "--json",
    ], repoRoot), "rollback active run");
    assert(rolledBack.data.run.status === "rolled-back", "rollback is recorded as a non-success terminal state");
    assert(rolledBack.data.run.tasks[0].status === "rolled-back", "rolled-back checkpoint cannot advance to PASS");
    assert(fs.readFileSync(path.join(blockedRun.worktreePath, "README.md"), "utf8").includes("Initial README"), "rollback restores tracked worktree content to the approved base");
    assert(JSON.parse(fs.readFileSync(blockedRun.ownershipPath, "utf8")).status === "rolled-back", "rollback releases ownership with an explicit outcome");

    const cancelledRun = createActiveRun(repoRoot, fake, "Cancel this active checkpoint");
    const cancelled = parseJson(runNode(cewpCli, [
      "supervise", "cancel", cancelledRun.runId, "--yes", "--json",
    ], repoRoot), "cancel active run");
    assert(cancelled.data.run.status === "cancelled", "active cancel is not represented as success");
    assert(JSON.parse(fs.readFileSync(cancelledRun.ownershipPath, "utf8")).status === "cancelled", "cancelled ownership is distinct from abandonment");
    assert(fs.existsSync(cancelledRun.worktreePath), "cancel preserves isolated partial work for inspection");

    const abandonedRun = createActiveRun(repoRoot, fake, "Abandon this active checkpoint");
    const abandoned = parseJson(runNode(cewpCli, [
      "supervise", "abandon", abandonedRun.runId, "--yes", "--json",
    ], repoRoot), "abandon active run");
    assert(abandoned.data.run.status === "abandoned", "abandon is a distinct terminal state");
    assert(JSON.parse(fs.readFileSync(abandonedRun.ownershipPath, "utf8")).status === "abandoned", "abandon releases the owned checkpoint explicitly");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

try {
  runBudgetDecisionContract();
  runOperatorControlContract();
  runManagedTerminationContract();
  console.log("[PASS] supervised budgets and operator controls remain bounded and recoverable");
} catch (error) {
  console.error("[FAIL] supervised budget/control contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
