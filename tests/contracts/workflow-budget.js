"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { evaluateWorkflowOperation } = require("../../src/workflow/budget");
const { validDefinition } = require("./workflow-definition");
const { successfulResult } = require("./workflow-result");
const { approveWorkflow } = require("./workflow-scheduler");
const { loadWorkflowRun } = require("../../src/workflow/state");
const { buildEvidenceReceipt } = require("../../src/evidence/receipt");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
  writeJson,
} = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function runtimeRun() {
  const definition = validDefinition();
  return {
    status: "active",
    createdAt: "2026-07-18T10:00:00.000Z",
    approval: { approvedAt: "2026-07-18T10:00:00.000Z" },
    tasks: definition.tasks.map((task) => ({ id: task.id, status: task.dependsOn.length ? "pending" : "ready" })),
    budget: {
      ...definition.budget,
      consumed: {
        modelOperations: 0,
        allocations: {
          implementation: 0,
          repair: 0,
          completion: 0,
          reviewer: 0,
          finalization: 0,
        },
        targetedVerificationRuns: 0,
        fullVerificationRuns: 0,
        capturedOutputBytes: 0,
      },
      thresholdEvents: [],
      revisions: [],
      hostLimit: null,
      pauseReason: null,
    },
  };
}

function runWorkflowBudgetContract() {
  const withinBudget = { now: new Date("2026-07-18T10:10:00.000Z") };
  const run = runtimeRun();
  assert(evaluateWorkflowOperation(run, "implementation", withinBudget).allowed, "fresh budget permits implementation");

  run.budget.consumed.modelOperations = 9;
  run.budget.consumed.allocations.implementation = 5;
  const warned = evaluateWorkflowOperation(run, "implementation", withinBudget);
  assert(warned.allowed && warned.warning === "budget-early-warning", "70 percent threshold warns without stopping");

  run.budget.consumed.modelOperations = 11;
  const reserved = evaluateWorkflowOperation(run, "implementation", withinBudget);
  assert(!reserved.allowed && reserved.reason === "completion-reserve-protected", "reserve threshold refuses new implementation");
  assert(reserved.pauseStatus === "paused-budget-safe", "safe checkpoint gets a safe pause");
  assert(evaluateWorkflowOperation(run, "reviewer", withinBudget).allowed, "protected reviewer allocation remains usable inside reserve");

  run.tasks[0].status = "running";
  const interrupted = evaluateWorkflowOperation(run, "implementation", withinBudget);
  assert(interrupted.pauseStatus === "paused-budget-unverified", "active checkpoint gets an unverified pause");
  run.tasks[0].status = "ready";

  run.budget.consumed.modelOperations = 12;
  const absolute = evaluateWorkflowOperation(run, "reviewer", withinBudget);
  assert(!absolute.allowed && absolute.reason === "absolute-ceiling-exhausted", "absolute ceiling refuses protected work too");

  const allocationRun = runtimeRun();
  allocationRun.budget.consumed.allocations.implementation = 6;
  const allocation = evaluateWorkflowOperation(allocationRun, "implementation", withinBudget);
  assert(!allocation.allowed && allocation.reason === "implementation-allocation-exhausted", "allocation cannot borrow silently");

  const hostRun = runtimeRun();
  hostRun.budget.hostLimit = { active: true, observedAt: "2026-07-18T10:05:00.000Z" };
  const host = evaluateWorkflowOperation(hostRun, "implementation", withinBudget);
  assert(!host.allowed && host.pauseStatus === "paused-host-limit", "host limit stays separate from CEWP budget");

  const elapsedRun = runtimeRun();
  const elapsed = evaluateWorkflowOperation(elapsedRun, "implementation", {
    now: new Date("2026-07-18T11:00:00.000Z"),
  });
  assert(!elapsed.allowed && elapsed.reason === "elapsed-time-ceiling-exhausted", "elapsed ceiling blocks new operations");

  const repoRoot = makeTempRepo("cewp-workflow-budget-gate-");
  try {
    const definition = validDefinition();
    definition.budget.allocations.implementation = 1;
    definition.budget.allocations.repair = 7;
    const approved = approveWorkflow(repoRoot, definition);
    const startedResult = runNode(cewpCli, [
      "workflow", "start", approved.runId,
      "--task", "implement-example", "--yes", "--json",
    ], repoRoot);
    assert(startedResult.status === 0, `budget fixture starts first task: ${startedResult.stderr}`);
    const started = JSON.parse(startedResult.stdout).data;
    writeJson(path.join(repoRoot, "result.json"), successfulResult(approved, started.checkpoint, [{
      command: "node --test tests/example.test.js",
      status: "passed",
      evidencePath: "evidence/targeted.json",
    }]));
    const recorded = runNode(cewpCli, [
      "workflow", "result", approved.runId,
      "--task", "implement-example", "--result", "result.json", "--yes", "--json",
    ], repoRoot);
    assert(recorded.status === 0, `budget fixture records first result: ${recorded.stderr}`);
    const refused = runNode(cewpCli, [
      "workflow", "start", approved.runId,
      "--task", "document-example", "--yes", "--json",
    ], repoRoot);
    assert(refused.status === 1, "exhausted implementation allocation refuses the next checkpoint");
    assert(refused.stderr.includes("implementation-allocation-exhausted"), "runtime refusal names the exhausted allocation");
    const paused = JSON.parse(runNode(cewpCli, [
      "workflow", "status", approved.runId, "--json",
    ], repoRoot).stdout).data.run;
    assert(paused.status === "paused-budget-safe", "budget refusal persists a safe pause");
    assert(paused.budget.pauseReason === "implementation-allocation-exhausted", "pause reason is canonical state");
    const pausedReceipt = buildEvidenceReceipt(loadWorkflowRun(repoRoot, approved.runId), {
      generatedAt: "2026-07-22T15:10:00.000Z",
    });
    assert(pausedReceipt.completeness.status === "partial" && pausedReceipt.budget.pauseReason === "implementation-allocation-exhausted", "budget-paused run has an explanatory partial receipt");
    assert(pausedReceipt.budget.compliance.absoluteCeilingRespected === true, "paused receipt proves the absolute ceiling was respected");
    assert(pausedReceipt.budget.compliance.protectedAllocationsRespected === true, "paused receipt proves protected allocations were preserved");
    assert(pausedReceipt.events.some((entry) => entry.category === "safe-pause"), "safe pause is normalized in the event ledger");
    assert(pausedReceipt.events.some((entry) => entry.category === "threshold"), "budget refusal records the reached threshold");
    assert(pausedReceipt.events.some((entry) => entry.category === "warning-presentation"), "budget refusal records Core warning presentation");
    assert(pausedReceipt.warningSurface.status === "observed" && pausedReceipt.warningSurface.deliveries[0].surface === "cewp-core-state", "receipt reports warning delivery only from event evidence");

    const addBudget = runNode(cewpCli, [
      "workflow", "intervene", approved.runId,
      "--event", "add-budget",
      "--operations", "1",
      "--allocation", "implementation",
      "--reason", "Operator approves one bounded continuation operation",
      "--yes",
      "--json",
    ], repoRoot);
    assert(addBudget.status === 0, `explicit budget expansion succeeds: ${addBudget.stderr}`);
    const expanded = JSON.parse(addBudget.stdout).data.run;
    assert(expanded.status === "active", "add-budget resumes a budget-paused run");
    assert(expanded.budget.modelOperations === 13, "absolute ceiling expands only by approved amount");
    assert(expanded.budget.allocations.implementation === 2, "selected allocation receives the same amount");
    assert(expanded.budget.revisions.length === 1, "budget expansion is revisioned");
    const resumedStart = runNode(cewpCli, [
      "workflow", "start", approved.runId,
      "--task", "document-example", "--yes", "--json",
    ], repoRoot);
    assert(resumedStart.status === 0, `expanded budget permits the next checkpoint: ${resumedStart.stderr}`);

    const hostPause = runNode(cewpCli, [
      "workflow", "intervene", approved.runId,
      "--event", "pause-host-limit",
      "--reason", "Supported host signal reports a temporary limit",
      "--yes",
      "--json",
    ], repoRoot);
    assert(hostPause.status === 0, `host limit pause succeeds: ${hostPause.stderr}`);
    const hostPaused = JSON.parse(hostPause.stdout).data.run;
    assert(hostPaused.status === "paused-host-limit", "host limit has a distinct run state");
    assert(hostPaused.budget.hostLimit.active === true, "host limit observation is retained");
    const hostPauseEvents = fs.readFileSync(path.join(repoRoot, ".cewp", "workflow-runs", approved.runId, "events.jsonl"), "utf8");
    assert(hostPauseEvents.includes("\"category\":\"host-limit\""), "manual host pause emits the host-limit lifecycle category");
    const hostResume = runNode(cewpCli, [
      "workflow", "intervene", approved.runId,
      "--event", "resume",
      "--reason", "Host limit is no longer active",
      "--yes",
      "--json",
    ], repoRoot);
    assert(hostResume.status === 0, `host limit resume succeeds: ${hostResume.stderr}`);
    const hostResumed = JSON.parse(hostResume.stdout).data.run;
    assert(hostResumed.status === "active", "host-paused run resumes explicitly");
    assert(hostResumed.budget.hostLimit === null, "resume clears the host-limit observation");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowBudgetContract();
  console.log("[PASS] workflow budget protects reserves and absolute ceilings");
} catch (error) {
  console.error("[FAIL] workflow budget contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
