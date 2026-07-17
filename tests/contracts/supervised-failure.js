"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { createFakeCodexAdapter } = require("../harness/lib/fake-adapter");
const { cleanupRepo, makeTempRepo, runNode } = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function parseJson(result, label, expectedStatus = 0) {
  assert(result.status === expectedStatus, `${label} exited ${result.status}: ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}\n${result.stdout}`);
  }
}

function createFailureRun(repoRoot) {
  const planned = parseJson(runNode(cewpCli, [
    "supervise", "plan",
    "--goal", "Repair a stable failing check",
    "--scope", "README.md",
    "--verify", "node -e \"process.stderr.write('stable failure'); process.exit(1)\"",
    "--stop", "The approved check passes",
    "--json",
  ], repoRoot), "plan");
  const runId = planned.data.run.runId;
  parseJson(runNode(cewpCli, ["supervise", "approve", runId, "--yes", "--json"], repoRoot), "approve");
  assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "policy setup");
  return runId;
}

function runSupervisedFailureContract() {
  const repoRoot = makeTempRepo("cewp-supervised-failure-");
  const fake = createFakeCodexAdapter();

  try {
    const runId = createFailureRun(repoRoot);
    const firstDispatch = parseJson(runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--json",
    ], repoRoot, { env: fake.env }), "initial dispatch");
    assert(firstDispatch.data.run.tasks[0].verification.runs[0].status === "fail", "baseline failure is captured");

    const firstFailure = parseJson(runNode(cewpCli, [
      "supervise", "verify", runId, "--json",
    ], repoRoot), "first verification", 1);
    const failedTask = firstFailure.data.run.tasks[0];
    assert(firstFailure.data.run.status === "needs-repair", "first post-change failure offers bounded repair");
    assert(failedTask.status === "repair-ready", "checkpoint remains incomplete");
    assert(failedTask.verification.latest.classification === "pre-existing", "baseline-equivalent failure is classified honestly");
    const firstSignature = failedTask.verification.latest.failureSignature;
    assert(firstSignature.startsWith("sha256:"), "failure signature is normalized and hashed");

    const repaired = parseJson(runNode(cewpCli, [
      "supervise", "retry", runId, "--yes", "--json",
    ], repoRoot, { env: fake.env }), "bounded repair dispatch");
    assert(repaired.data.run.status === "verifying", "successful repair dispatch returns to verification");
    assert(repaired.data.run.tasks[0].attempts.length === 2, "repair is a distinct attempt");
    assert(repaired.data.run.tasks[0].attempts[1].kind === "repair", "attempt kind is explicit");
    assert(repaired.data.run.budget.consumed.allocations.repair === 1, "repair consumes only repair allocation");

    const repeated = parseJson(runNode(cewpCli, [
      "supervise", "verify", runId, "--json",
    ], repoRoot), "repeated verification", 1);
    assert(repeated.data.run.status === "blocked", "repeated normalized failure blocks the run");
    assert(repeated.data.run.tasks[0].status === "blocked", "failed checkpoint never advances");
    assert(repeated.data.run.tasks[0].blocker.code === "repeated-verification-failure", "blocker is actionable");
    assert(repeated.data.run.tasks[0].verification.latest.failureSignature === firstSignature, "same failure normalizes to same signature");

    const unlimitedRetry = runNode(cewpCli, [
      "supervise", "retry", runId, "--yes", "--json",
    ], repoRoot, { env: fake.env });
    assert(unlimitedRetry.status === 1, "blocked run cannot start another repair operation");
    assert(unlimitedRetry.stderr.includes("blocked"), "retry refusal reports the blocked state");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

try {
  runSupervisedFailureContract();
  console.log("[PASS] repeated supervised verification failures stop the repair loop");
} catch (error) {
  console.error("[FAIL] supervised failure contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
