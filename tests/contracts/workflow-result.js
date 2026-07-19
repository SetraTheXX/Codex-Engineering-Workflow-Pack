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
          command: "git status --short",
          status: "passed",
          evidencePath: "evidence/baseline.json",
        }],
      },
      targeted,
      full: [],
    },
    usage: {
      managedOperations: { label: "observed", value: 1, source: "codex-exec" },
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
    assert(fs.existsSync(path.join(repoRoot, recorded.data.resultPath)), "validated result is persisted under the run");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowResultContract();
  console.log("[PASS] workflow result requires scoped verification evidence");
} catch (error) {
  console.error("[FAIL] workflow result contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
