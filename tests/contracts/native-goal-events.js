"use strict";

const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo } = require("../harness/lib/temp-repo");
const { supportedSnapshot } = require("./integration-capabilities");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const { createHostBinding } = require("../../src/integration/binding");
const {
  normalizeNativeGoalEvent,
  readNativeGoalEvents,
  recordNativeGoalEvent,
} = require("../../src/integration/native-goal");
const { loadWorkflowRun, startWorkflowTask } = require("../../src/workflow/state");

function nativeDefinition(workflowId) {
  const definition = validDefinition();
  definition.workflowId = workflowId;
  definition.execution = { owner: "native", backend: null, allowedModes: ["supervised"] };
  return definition;
}

function pluginSnapshot() {
  const snapshot = supportedSnapshot();
  snapshot.surfaces.hostObservation = {
    status: "supported",
    source: "plugin",
    pluginPathCapabilityTestPassed: true,
  };
  return snapshot;
}

function attach(repoRoot, runId, capabilities, goalId) {
  const found = loadWorkflowRun(repoRoot, runId);
  createHostBinding(found, {
    schemaVersion: "host-binding/v1",
    workflow: { runId, taskId: null, checkpointId: null },
    execution: { owner: "native", backend: null },
    host: { product: "codex", surface: "chatgpt-desktop", version: "0.137.0" },
    mode: "attached",
    provenance: {
      kind: "plugin-observed",
      capabilitySchemaVersion: "codex-integration-capabilities/v1",
      authenticationBoundary: "host-owned",
      recordedAt: "2026-07-18T12:00:00.000Z",
    },
    references: { goalId, threadId: "thread-native-1", turnId: null, subagents: [], worktree: null },
    controls: {
      preventive: ["workflow-definition", "ownership-conflict"],
      postExecution: [],
      imported: [],
      unavailable: ["private-desktop-session-control"],
    },
  }, { capabilities });
}

function event(runId, type, status, sequence, overrides = {}) {
  return {
    schemaVersion: "native-goal-event/v1",
    eventId: `native-event-${String(sequence).padStart(4, "0")}`,
    receivedAt: `2026-07-18T12:${String(sequence).padStart(2, "0")}:00.000Z`,
    source: {
      path: "plugin",
      codexVersion: "codex-cli 0.137.0",
      nativeGoalSchemaVersion: "codex-app-server-schema/0.137.0",
      capabilitySchemaVersion: "codex-integration-capabilities/v1",
      authenticationBoundary: "host-owned",
    },
    workflow: {
      runId,
      taskId: "implement-example",
      checkpointId: "implement-example-attempt-0001",
    },
    goalId: "goal-native-1",
    type,
    status,
    partialOutput: null,
    raw: { type, status, goalId: "goal-native-1" },
    ...overrides,
  };
}

function activeNativeRun(repoRoot, workflowId, capabilities) {
  const approved = approveWorkflow(repoRoot, nativeDefinition(workflowId));
  attach(repoRoot, approved.runId, capabilities, "goal-native-1");
  startWorkflowTask(loadWorkflowRun(repoRoot, approved.runId), "implement-example", {
    now: new Date("2026-07-18T12:00:00.000Z"),
  });
  return approved.runId;
}

function main() {
  const repoRoot = makeTempRepo("cewp-native-goal-events-");
  try {
    const capabilities = pluginSnapshot();
    const runId = activeNativeRun(repoRoot, "native-event-matrix", capabilities);

    const started = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "started", "active", 1),
      { capabilities },
    );
    assert(started.event.mapping.state === "active", "versioned start maps active");
    assert(started.application.action === "none", "already-active start does not duplicate checkpoint state");

    const checkpoint = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "checkpoint", "active", 2),
      { capabilities },
    );
    assert(checkpoint.event.mapping.state === "evidence-pending", "host checkpoint requires CEWP evidence intake");
    assert(checkpoint.application.successClaimed === false, "host checkpoint cannot claim CEWP success");

    const revised = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "revised", "active", 3),
      { capabilities },
    );
    assert(revised.application.action === "inspect-revision", "host revision remains an explicit CEWP revision decision");

    const budgetLimited = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "status", "budgetLimited", 4),
      { capabilities },
    );
    assert(budgetLimited.event.mapping.state === "paused-host-limit", "versioned goal budget maps host-limit pause");
    assert(budgetLimited.event.mapping.limitKind === "goal-budget", "goal budget stays distinct from account usage limits");
    assert(budgetLimited.run.status === "paused-host-limit", "host-limit mapping pauses canonical run state");
    assert(budgetLimited.run.tasks[0].status === "running", "host limit does not complete the checkpoint");

    const resumed = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "resumed", "active", 5),
      { capabilities },
    );
    assert(resumed.run.status === "active", "host reset/resume restores the canonical run");

    const complete = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "status", "complete", 6),
      { capabilities },
    );
    assert(complete.event.mapping.state === "evidence-pending", "native complete is not checkpoint success");
    assert(complete.run.status === "active", "native complete leaves CEWP gates open for evidence");

    const partial = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "partial-output", null, 7, {
        partialOutput: { present: true, bytes: 42, complete: false },
      }),
      { capabilities },
    );
    assert(partial.event.mapping.state === "interrupted", "partial output maps interruption, not completion");
    assert(partial.run.status === "interrupted", "partial output preserves resumable canonical state");

    const resumedPartial = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "resumed", "active", 8),
      { capabilities },
    );
    assert(resumedPartial.run.status === "active", "partial output checkpoint resumes explicitly");

    const stopped = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, runId),
      event(runId, "stopped", null, 9),
      { capabilities },
    );
    assert(stopped.run.status === "cancelled", "native stop maps explicit cancellation");
    assert(stopped.application.successClaimed === false, "stop never claims success");

    const timeoutRunId = activeNativeRun(repoRoot, "native-timeout", capabilities);
    const timedOut = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, timeoutRunId),
      event(timeoutRunId, "timed-out", null, 10),
      { capabilities },
    );
    assert(timedOut.run.status === "timed-out", "native timeout remains distinct from cancellation and failure");

    const usageRunId = activeNativeRun(repoRoot, "native-usage-limit", capabilities);
    const usageLimited = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, usageRunId),
      event(usageRunId, "status", "usageLimited", 11),
      { capabilities },
    );
    assert(usageLimited.event.mapping.limitKind === "account-usage", "usage limit stays distinct from goal budget");

    const driftedEvent = event(runId, "status", "usageLimited", 12);
    driftedEvent.source.nativeGoalSchemaVersion = "codex-app-server-schema/0.138.0";
    const drifted = normalizeNativeGoalEvent(driftedEvent, { capabilities });
    assert(drifted.mapping.state === "paused-host-limit", "drifted known limit uses generic host-limit fallback");
    assert(drifted.mapping.limitKind === "unknown", "schema drift does not infer exact limit semantics");
    assert(drifted.compatibility === "drifted", "schema drift is explicit");

    const unavailable = normalizeNativeGoalEvent(event(runId, "status", "futureStatus", 13), { capabilities });
    assert(unavailable.mapping.state === "unknown", "unavailable future status remains unknown");

    const malformed = recordNativeGoalEvent(
      loadWorkflowRun(repoRoot, usageRunId),
      event(usageRunId, "malformed", null, 14, { raw: { unexpected: true } }),
      { capabilities },
    );
    assert(malformed.event.availability === "malformed", "malformed event is retained without state mutation");
    assert(malformed.application.action === "none", "malformed event cannot mutate canonical state");

    const ledger = readNativeGoalEvents(loadWorkflowRun(repoRoot, runId));
    assert(ledger.length === 9, "main native lifecycle ledger is append-only");
    assert(ledger.every((entry) => entry.application.successClaimed === false), "native events never bypass CEWP success gates");

    console.log("[PASS] native goal events map versioned limits and recovery without fabricating success");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  main();
} catch (error) {
  console.error("[FAIL] native goal event contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
