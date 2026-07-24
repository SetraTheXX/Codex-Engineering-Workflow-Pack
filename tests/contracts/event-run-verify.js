"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode, writeFile } = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const { loadWorkflowRun, startWorkflowTask } = require("../../src/workflow/state");
const { writeEvidenceReceipt } = require("../../src/evidence/receipt");
const {
  EVENT_SCHEMA_VERSION,
  EVENT_CATEGORIES,
  normalizeLifecycleEvent,
  readLifecycleEvents,
} = require("../../src/evidence/events");
const { verifyWorkflowRun } = require("../../src/evidence/verify");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function digest(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function runContract() {
  const repoRoot = makeTempRepo("cewp-event-run-verify-");
  try {
    const approved = approveWorkflow(repoRoot, validDefinition());
    const categories = new Set(Object.values(EVENT_CATEGORIES));
    for (const required of [
      "run", "plan-revision", "task", "checkpoint", "dispatch", "operator-intervention", "verification",
      "usage-observation", "estimate-revision", "budget-approval", "allocation-consumption", "threshold",
      "warning-presentation", "safe-pause", "unverified-pause", "host-limit", "scope", "review",
      "cancellation", "finalize",
    ]) assert(categories.has(required), `event vocabulary includes ${required}`);
    let found = loadWorkflowRun(repoRoot, approved.runId);
    const eventsPath = path.join(found.runRoot, "events.jsonl");
    const events = readLifecycleEvents(eventsPath, { runId: approved.runId });
    assert(events.length === 2, "approved workflow writes run and budget approval events");
    assert(events[0].schemaVersion === EVENT_SCHEMA_VERSION, "new lifecycle events use event/v1");
    assert(events[0].category === "run", "workflow approval is categorized as a run event");
    assert(events[1].category === "budget-approval", "approved envelope is a distinct budget event");

    const legacy = normalizeLifecycleEvent({
      schemaVersion: "workflow-event/v1",
      timestamp: "2026-07-22T10:00:00.000Z",
      type: "task-started",
      runId: approved.runId,
      taskId: "implement-example",
    }, { allowLegacy: true });
    assert(legacy.schemaVersion === EVENT_SCHEMA_VERSION && legacy.category === "task", "legacy workflow events normalize without rewriting history");

    const startedAt = new Date(new Date(found.run.createdAt).getTime() + 1000);
    startWorkflowTask(found, "implement-example", { now: startedAt });
    found = loadWorkflowRun(repoRoot, approved.runId);
    const startedEvents = readLifecycleEvents(eventsPath, { runId: approved.runId });
    for (const category of ["checkpoint", "dispatch", "task"]) {
      assert(startedEvents.some((entry) => entry.category === category), `task start emits ${category} lifecycle evidence`);
    }
    writeEvidenceReceipt(found, { generatedAt: "2026-07-22T10:01:00.000Z" });
    const healthy = verifyWorkflowRun(repoRoot, approved.runId);
    assert(healthy.schemaVersion === "run-verification/v1", "run verification is versioned");
    assert(healthy.status === "passed", "consistent run with intact partial receipt passes health verification");
    assert(healthy.execution.agentsExecuted === false && healthy.execution.verificationCommandsExecuted === false, "run verify remains read-only");
    assert(healthy.checks.some((entry) => entry.id === "receipt-integrity" && entry.status === "passed"), "receipt integrity is recomputed");

    const cli = runNode(cewpCli, ["run", "verify", approved.runId, "--json"], repoRoot);
    assert(cli.status === 0, `run verify CLI succeeds for healthy evidence: ${cli.stderr}`);
    const cliOutput = JSON.parse(cli.stdout);
    assert(cliOutput.schemaVersion === "operator-json/v1" && cliOutput.command === "run.verify", "run verify uses operator JSON");

    const receiptPath = path.join(found.runRoot, "evidence-receipt.json");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    receipt.integrity.files[0].sha256 = digest("tampered");
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    fs.appendFileSync(eventsPath, "{malformed\n");
    fs.appendFileSync(eventsPath, `${JSON.stringify({
      schemaVersion: "event/v999",
      category: "task",
      timestamp: new Date(startedAt.getTime() + 1000).toISOString(),
      type: "task-started",
      runId: approved.runId,
    })}\n`);
    const checkpointDir = path.join(found.runRoot, "checkpoints", "implement-example");
    fs.rmSync(path.join(checkpointDir, fs.readdirSync(checkpointDir)[0]));
    writeFile(path.join(found.runRoot, "integration", "host-binding.json"), JSON.stringify({
      schemaVersion: "host-binding/v1",
      references: { worktree: { id: "gone", path: path.join(repoRoot, ".cewp-worktrees", "gone") } },
    }));
    const unhealthy = verifyWorkflowRun(repoRoot, approved.runId);
    assert(unhealthy.status === "failed", "health verification fails closed on evidence defects");
    assert(unhealthy.issues.some((entry) => entry.code === "malformed-event"), "malformed events are reported");
    assert(unhealthy.issues.some((entry) => entry.code === "incompatible-event-schema"), "incompatible event schemas are reported");
    assert(unhealthy.issues.some((entry) => entry.code === "receipt-integrity-mismatch"), "receipt tampering is reported");
    assert(unhealthy.issues.some((entry) => entry.code === "missing-checkpoint"), "missing active checkpoints are reported");
    assert(unhealthy.issues.some((entry) => entry.code === "stale-worktree"), "missing bound worktrees are reported");

    const failedCli = runNode(cewpCli, ["run", "verify", approved.runId, "--json"], repoRoot);
    assert(failedCli.status !== 0, "run verify exits nonzero when health verification fails");
    const failedOutput = JSON.parse(failedCli.stdout);
    assert(failedOutput.data.status === "failed", "failed operator JSON remains inspectable");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] event vocabulary and read-only run verification");
} catch (error) {
  console.error("[FAIL] event vocabulary and run verification contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
