"use strict";

const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
  writeJson,
} = require("../harness/lib/temp-repo");
const { approveWorkflow } = require("./workflow-scheduler");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function matrixDefinition(workerCount) {
  const tasks = Array.from({ length: workerCount }, (_, index) => {
    const number = index + 1;
    return {
      id: `matrix-task-${number}`,
      title: `Complete independent matrix task ${number}`,
      dependsOn: [],
      allowedFiles: [`src/matrix-${number}.js`],
      forbiddenFiles: ["package.json"],
      stoppingConditions: [`Matrix check ${number} passes`],
      verification: {
        targeted: [`node --test tests/matrix-${number}.test.js`],
        full: [],
      },
      risk: "low",
    };
  });
  return {
    schemaVersion: "workflow-definition/v1",
    workflowId: `worker-matrix-${workerCount}`,
    revision: { number: 1, parent: null, reason: "initial matrix fixture" },
    goal: `Complete a deterministic ${workerCount}-worker fake workflow`,
    tasks,
    assurance: { profile: "standard", testAuthoring: "never" },
    checkpointPolicy: { required: true, reviewerAfterEachTask: false },
    reviewerPolicy: { requiredForFinalize: false },
    execution: { owner: "managed", backend: "codex-exec", allowedModes: ["supervised"] },
    budget: {
      schemaVersion: "budget-envelope/v1",
      modelOperations: workerCount + 3,
      allocations: {
        implementation: workerCount,
        repair: 0,
        completion: 1,
        reviewer: 1,
        finalization: 1,
      },
      protectedAllocations: ["completion", "reviewer", "finalization"],
      maxRepairsPerCheckpoint: 0,
      maxElapsedMinutes: 45,
      maxConcurrentWorkers: workerCount,
      maxCapturedOutputBytes: 8192,
      maxTargetedVerificationRuns: workerCount * 2,
      maxFullVerificationRuns: 0,
      thresholds: { earlyWarningPercent: 70, reservePercent: 90, absoluteCeilingPercent: 100 },
    },
  };
}

function matrixResult(run, checkpoint, number) {
  const command = `node --test tests/matrix-${number}.test.js`;
  const evidence = (stage) => ({
    command,
    status: "passed",
    evidencePath: `evidence/matrix-${number}-${stage}.json`,
  });
  return {
    schemaVersion: "task-result/v1",
    resultId: `matrix-task-${number}-result`,
    runId: run.runId,
    taskId: checkpoint.taskId,
    checkpointId: checkpoint.checkpointId,
    outcome: "succeeded",
    completedAt: `2026-07-18T12:00:${String(number).padStart(2, "0")}.000Z`,
    changedFiles: [`src/matrix-${number}.js`],
    verification: {
      baseline: { status: "passed", evidence: [evidence("baseline")] },
      targeted: [evidence("targeted")],
      full: [],
    },
    usage: {
      managedOperations: { label: "observed", value: 1, source: "fake-codex-jsonl" },
      capturedOutputBytes: { label: "observed", value: 32, source: "fake-bounded-output" },
      managedTokens: { label: "unknown", value: null, reason: "fake workflow has no token stream" },
      hostInternal: { label: "unknown", value: null, reason: "fake workflow has no host usage" },
    },
    artifacts: [{ kind: "fake-diff", path: `evidence/matrix-${number}.diff` }],
    failure: null,
  };
}

function runMatrixCase(workerCount) {
  const repoRoot = makeTempRepo(`cewp-workflow-${workerCount}-worker-`);
  try {
    const run = approveWorkflow(repoRoot, matrixDefinition(workerCount));
    const initial = JSON.parse(runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot).stdout).data;
    assert(initial.readyTasks.length === workerCount, `${workerCount}-worker workflow exposes all independent tasks`);
    assert(initial.capacity.maximum === workerCount, `${workerCount}-worker capacity is definition-owned`);

    const checkpoints = [];
    for (let index = 0; index < workerCount; index += 1) {
      const number = index + 1;
      const startedResult = runNode(cewpCli, [
        "workflow", "start", run.runId,
        "--task", `matrix-task-${number}`,
        "--worker", `worker-${number}`,
        "--yes", "--json",
      ], repoRoot);
      assert(startedResult.status === 0, `${workerCount}-worker task ${number} starts: ${startedResult.stderr}`);
      const started = JSON.parse(startedResult.stdout).data;
      assert(started.checkpoint.worker.id === `worker-${number}`, "numeric worker identity is retained without alphabet assumptions");
      checkpoints.push(started.checkpoint);
    }
    const saturated = JSON.parse(runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot).stdout).data;
    assert(saturated.capacity.active === workerCount && saturated.capacity.available === 0, `${workerCount}-worker capacity saturates exactly`);

    for (let index = 0; index < checkpoints.length; index += 1) {
      const number = index + 1;
      writeJson(path.join(repoRoot, `matrix-result-${number}.json`), matrixResult(run, checkpoints[index], number));
      const recorded = runNode(cewpCli, [
        "workflow", "result", run.runId,
        "--task", `matrix-task-${number}`,
        "--result", `matrix-result-${number}.json`,
        "--yes", "--json",
      ], repoRoot);
      assert(recorded.status === 0, `${workerCount}-worker task ${number} records: ${recorded.stderr}`);
    }
    const completed = JSON.parse(runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot).stdout).data;
    assert(completed.run.status === "completed", `${workerCount}-worker workflow reaches the no-review completion gate`);
    assert(completed.progress.summary.completed === workerCount, `${workerCount}-worker progress derives every verified task`);
    assert(completed.run.budget.consumed.modelOperations === workerCount, `${workerCount}-worker usage counts only observed fake operations`);
    assert(completed.run.budget.consumed.targetedVerificationRuns === workerCount * 2, `${workerCount}-worker verification accounting is exact`);

    const finalized = runNode(cewpCli, [
      "workflow", "finalize", run.runId, "--yes", "--json",
    ], repoRoot);
    assert(finalized.status === 0, `${workerCount}-worker workflow finalizes: ${finalized.stderr}`);
    assert(JSON.parse(finalized.stdout).data.run.status === "finalized", `${workerCount}-worker workflow reaches a terminal state`);
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  for (const workerCount of [1, 2, 4]) runMatrixCase(workerCount);
  console.log("[PASS] one, two, and four worker fake workflows complete deterministically");
} catch (error) {
  console.error("[FAIL] workflow worker matrix contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
