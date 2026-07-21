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

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function successfulResult(run, checkpoint, targeted = []) {
  return {
    schemaVersion: "task-result/v1",
    resultId: `${checkpoint.taskId}-result-${checkpoint.attempt}`,
    runId: run.runId,
    taskId: checkpoint.taskId,
    checkpointId: checkpoint.checkpointId,
    outcome: "succeeded",
    completedAt: "2026-07-18T12:00:00.000Z",
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
      targeted,
      full: [],
    },
    usage: {
      managedOperations: { label: "observed", value: 1, source: "codex-exec" },
      capturedOutputBytes: { label: "observed", value: 256, source: "cewp-bounded-output" },
      managedTokens: { label: "unknown", value: null, reason: "fixture omits token usage" },
      hostInternal: { label: "unknown", value: null, reason: "host usage is unavailable" },
    },
    artifacts: [{ kind: "diff", path: "evidence/change.diff" }],
    failure: null,
  };
}

function runWorkflowResultContract() {
  const repoRoot = makeTempRepo("cewp-workflow-result-");
  try {
    const run = approveWorkflow(repoRoot, validDefinition());
    const startResult = runNode(cewpCli, [
      "workflow", "start", run.runId,
      "--task", "implement-example",
      "--yes",
      "--json",
    ], repoRoot);
    assert(startResult.status === 0, `result fixture task starts: ${startResult.stderr}`);
    const started = JSON.parse(startResult.stdout).data;

    writeJson(path.join(repoRoot, "invalid-result.json"), successfulResult(run, started.checkpoint));
    const invalid = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "invalid-result.json",
      "--yes",
      "--json",
    ], repoRoot);
    assert(invalid.status === 1, "success without targeted verification evidence is rejected");
    assert(invalid.stderr.includes("missing targeted verification"), "missing evidence refusal names the command class");
    const afterInvalid = JSON.parse(runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot).stdout);
    assert(afterInvalid.data.run.tasks.find((task) => task.id === "implement-example").status === "running", "invalid result cannot advance task state");

    const spoofedBaseline = successfulResult(run, started.checkpoint, [{
      command: "node --test tests/example.test.js",
      status: "passed",
      evidencePath: "evidence/targeted.json",
    }]);
    spoofedBaseline.verification.baseline.evidence[0].command = "node -e \"process.exit(0)\"";
    writeJson(path.join(repoRoot, "spoofed-baseline.json"), spoofedBaseline);
    const spoofed = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "spoofed-baseline.json", "--yes", "--json",
    ], repoRoot);
    assert(spoofed.status === 1, "unapproved baseline command cannot satisfy the checkpoint");
    assert(spoofed.stderr.includes("missing baseline verification"), "baseline refusal names the approved command class");

    const estimatedUsage = successfulResult(run, started.checkpoint, [{
      command: "node --test tests/example.test.js",
      status: "passed",
      evidencePath: "evidence/targeted.json",
    }]);
    estimatedUsage.usage.managedOperations.label = "estimated";
    writeJson(path.join(repoRoot, "estimated-usage.json"), estimatedUsage);
    const estimated = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "estimated-usage.json", "--yes", "--json",
    ], repoRoot);
    assert(estimated.status === 1, "estimated operations cannot become observed managed usage");
    assert(estimated.stderr.includes("positive observed managed operation"), "managed usage refusal names the truth requirement");

    const validResult = successfulResult(run, started.checkpoint, [{
      command: "node --test tests/example.test.js",
      status: "passed",
      evidencePath: "evidence/targeted.json",
    }]);
    writeJson(path.join(repoRoot, "valid-result.json"), validResult);
    const recordedResult = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "valid-result.json",
      "--yes",
      "--json",
    ], repoRoot);
    assert(recordedResult.status === 0, `verified result is accepted: ${recordedResult.stderr}`);
    const recorded = JSON.parse(recordedResult.stdout);
    assert(recorded.command === "workflow.result", "result output identifies the command");
    assert(recorded.data.result.schemaVersion === "task-result/v1", "result contract remains versioned");
    assert(recorded.data.checkpoint.status === "verified", "checkpoint becomes verified");
    assert(recorded.data.run.tasks.find((task) => task.id === "implement-example").status === "completed", "verified task becomes completed");
    assert(recorded.data.run.tasks.find((task) => task.id === "document-example").status === "ready", "completed dependency opens its child");
    assert(recorded.data.run.status === "active", "remaining work keeps the run active");
    assert(recorded.data.run.budget.consumed.targetedVerificationRuns === 2, "baseline and targeted verification consume separate local-run budget");
    assert(recorded.data.run.budget.consumed.fullVerificationRuns === 0, "unused full verification budget remains untouched");
    assert(recorded.data.run.budget.consumed.capturedOutputBytes === 256, "bounded output bytes are accounted independently");
    assert(recorded.data.progress.summary.completed === 1, "derived progress counts only the verified result");
    assert(fs.existsSync(path.join(repoRoot, recorded.data.resultPath)), "validated result is persisted under the run");
  } finally {
    cleanupRepo(repoRoot);
  }
}

function runWorkflowOutputBudgetRefusal() {
  const repoRoot = makeTempRepo("cewp-workflow-result-output-budget-");
  try {
    const definition = validDefinition();
    definition.tasks = [definition.tasks[0]];
    definition.budget.maxCapturedOutputBytes = 1024;
    const run = approveWorkflow(repoRoot, definition);
    const started = JSON.parse(runNode(cewpCli, [
      "workflow", "start", run.runId,
      "--task", "implement-example", "--yes", "--json",
    ], repoRoot).stdout).data;
    const oversized = successfulResult(run, started.checkpoint, [{
      command: "node --test tests/example.test.js",
      status: "passed",
      evidencePath: "evidence/targeted.json",
    }]);
    oversized.usage.capturedOutputBytes.value = 1025;
    writeJson(path.join(repoRoot, "oversized-result.json"), oversized);
    const refused = runNode(cewpCli, [
      "workflow", "result", run.runId,
      "--task", "implement-example",
      "--result", "oversized-result.json", "--yes", "--json",
    ], repoRoot);
    assert(refused.status === 1, "captured output above the approved ceiling is rejected");
    assert(refused.stderr.includes("captured-output ceiling"), "output ceiling refusal names the exhausted resource");
    const status = JSON.parse(runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot).stdout).data.run;
    assert(status.status === "paused-budget-unverified", "mid-checkpoint output exhaustion pauses as unverified");
    assert(status.budget.pauseReason === "captured-output-budget-exhausted", "output pause reason is canonical");
    assert(status.tasks[0].status === "running", "rejected result never completes the active task");
    assert(status.budget.consumed.capturedOutputBytes === 0, "rejected result never fabricates observed consumption");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "workflow-runs", run.runId, "results")), "rejected result is not persisted");
  } finally {
    cleanupRepo(repoRoot);
  }
}

if (require.main === module) {
  try {
    runWorkflowResultContract();
    runWorkflowOutputBudgetRefusal();
    console.log("[PASS] workflow result requires scoped verification evidence");
  } catch (error) {
    console.error("[FAIL] workflow result contract");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = {
  successfulResult,
};
