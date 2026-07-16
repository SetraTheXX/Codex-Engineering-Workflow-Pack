"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
} = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function readJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}\n${result.stdout}\n${result.stderr}`);
  }
}

function runSupervisedIntakeContract() {
  const repoRoot = makeTempRepo("cewp-supervised-intake-");

  try {
    const result = runNode(cewpCli, [
      "supervise",
      "plan",
      "--goal",
      "Repair the focused example behavior",
      "--scope",
      "src/example.js",
      "--verify",
      "node --test test/example.test.js",
      "--stop",
      "The focused verification passes",
      "--json",
    ], repoRoot);

    assert(result.status === 0, `supervised plan exits successfully: ${result.stderr}`);
    const output = readJsonOutput(result, "supervise plan");
    assert(output.schemaVersion === "operator-json/v1", "plan output uses operator JSON envelope");
    assert(output.command === "supervise.plan", "plan output identifies the command");
    assert(output.data.run.schemaVersion === "supervised-run/v1", "canonical run schema is versioned");
    assert(output.data.run.status === "proposed", "new run waits for explicit approval");
    assert(output.data.run.mode === "supervised", "golden path is supervised");
    assert(output.data.run.execution.owner === "managed", "golden path has exactly one owner");
    assert(output.data.run.execution.backend === "codex-exec", "golden path has exactly one backend");
    assert(output.data.run.tasks.length === 1, "Phase 9 intake creates one bounded checkpoint");
    assert(output.data.run.tasks[0].allowedFiles[0] === "src/example.js", "scope is canonical state");
    assert(output.data.run.tasks[0].verification.targeted[0] === "node --test test/example.test.js", "verification is canonical state");
    assert(output.data.run.tasks[0].stoppingConditions[0] === "The focused verification passes", "stopping condition is canonical state");
    assert(output.data.run.assurance.profile === "standard", "standard assurance is the default");
    assert(output.data.run.assurance.testAuthoring === "auto", "auto test authoring is the default");
    assert(output.data.run.budget.maxConcurrentWorkers.value === 1, "default run is single-worker");
    assert(output.data.run.budget.maxRepairsPerCheckpoint.value === 2, "default repair limit is two");
    assert(output.data.run.budget.modelOperations.label === "budgeted", "operation maximum is explicitly budgeted");
    assert(output.data.run.usage.managedTokens.label === "unknown", "pre-run tokens are not fabricated");
    assert(output.data.run.usage.hostInternal.label === "unknown", "host-internal usage is unknown");

    const runRoot = path.join(repoRoot, ".cewp", "supervised-runs", output.data.run.runId);
    assert(fs.existsSync(path.join(runRoot, "run.json")), "canonical run is persisted locally");
    assert(fs.existsSync(path.join(runRoot, "events.jsonl")), "append-only event log is created");
    assert(fs.existsSync(path.join(runRoot, "progress.md")), "progress view is generated from state");

    const rejectedApproval = runNode(cewpCli, [
      "supervise",
      "approve",
      output.data.run.runId,
    ], repoRoot);
    assert(rejectedApproval.status === 1, "approval requires an explicit confirmation flag");
    assert(rejectedApproval.stderr.includes("--yes"), "approval explains the confirmation requirement");

    const approvedResult = runNode(cewpCli, [
      "supervise",
      "approve",
      output.data.run.runId,
      "--yes",
      "--json",
    ], repoRoot);
    assert(approvedResult.status === 0, `explicit approval succeeds: ${approvedResult.stderr}`);
    const approved = readJsonOutput(approvedResult, "supervise approve");
    assert(approved.command === "supervise.approve", "approval output identifies the command");
    assert(approved.data.run.status === "approved", "approval opens the run, not execution");
    assert(approved.data.run.tasks[0].status === "ready", "approved checkpoint becomes ready");
    assert(approved.data.run.approval.actor === "operator", "operator approval is canonical state");

    fs.writeFileSync(path.join(runRoot, "progress.md"), "# forged completion\n");
    const statusResult = runNode(cewpCli, [
      "supervise",
      "status",
      output.data.run.runId,
      "--json",
    ], repoRoot);
    assert(statusResult.status === 0, `supervised status succeeds: ${statusResult.stderr}`);
    const status = readJsonOutput(statusResult, "supervise status");
    assert(status.command === "supervise.status", "status output identifies the command");
    assert(status.data.run.status === "approved", "Markdown edits do not mutate canonical state");
    assert(status.data.nextAction.command.includes("supervise execute"), "status shows the next safe action");
    assert(!fs.readFileSync(path.join(runRoot, "progress.md"), "utf8").includes("forged completion"), "status regenerates progress from canonical state");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runSupervisedIntakeContract();
  console.log("[PASS] supervised intake creates a bounded approval preview");
} catch (error) {
  console.error("[FAIL] supervised intake contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
