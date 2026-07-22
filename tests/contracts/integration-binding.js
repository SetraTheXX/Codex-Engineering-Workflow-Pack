"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo } = require("../harness/lib/temp-repo");
const { supportedSnapshot } = require("./integration-capabilities");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const {
  createGeneratedGoalBrief,
  createHostBinding,
  loadHostBinding,
} = require("../../src/integration/binding");
const { loadWorkflowRun, startWorkflowTask } = require("../../src/workflow/state");

function assertThrows(action, expected, label) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  assert(error, `${label}: expected an error`);
  assert(expected.test(error.message), `${label}: unexpected error: ${error.message}`);
}

function nativeDefinition() {
  const definition = validDefinition();
  definition.workflowId = "native-integration";
  definition.execution = {
    owner: "native",
    backend: null,
    allowedModes: ["supervised"],
  };
  return definition;
}

function explicitBinding(runId) {
  return {
    schemaVersion: "host-binding/v1",
    workflow: { runId, taskId: null, checkpointId: null },
    execution: { owner: "native", backend: null },
    host: { product: "codex", surface: "chatgpt-desktop", version: null },
    mode: "explicit-intake",
    provenance: {
      kind: "explicit-intake",
      capabilitySchemaVersion: null,
      authenticationBoundary: "host-owned",
      recordedAt: "2026-07-18T12:00:00.000Z",
    },
    references: {
      goalId: "goal-local-1",
      threadId: "thread-local-1",
      turnId: null,
      subagents: [{
        id: "subagent-local-1",
        threadId: "subthread-local-1",
        summary: "Inspected the bounded native checkpoint.",
      }],
      worktree: null,
    },
    controls: {
      preventive: ["workflow-definition", "ownership-conflict"],
      postExecution: [],
      imported: ["goal-reference"],
      unavailable: ["native-tool-enforcement", "host-usage"],
    },
  };
}

function main() {
  const repoRoot = makeTempRepo("cewp-integration-binding-");
  try {
    const approved = approveWorkflow(repoRoot, nativeDefinition());
    const found = loadWorkflowRun(repoRoot, approved.runId);
    const runBefore = fs.readFileSync(found.runPath, "utf8");

    const brief = createGeneratedGoalBrief(found);
    assert(brief.schemaVersion === "generated-goal-brief/v1", "native fallback has a versioned contract");
    assert(brief.workflow.runId === approved.runId, "goal brief carries CEWP run identity");
    assert(brief.fallback === "explicit-intake", "goal brief names the supported intake fallback");
    assert(brief.objective.includes(approved.runId), "goal objective tells the host which CEWP run to update");
    assert(!brief.claims.liveAttachment, "goal brief does not claim live attachment");

    const created = createHostBinding(found, explicitBinding(approved.runId), {
      capabilities: supportedSnapshot(),
    });
    assert(created.mode === "explicit-intake", "explicit binding stays explicit intake");
    assert(created.references.goalId === "goal-local-1", "goal reference is preserved in sidecar");
    assert(created.references.subagents[0].threadId === "subthread-local-1", "subagent identity is preserved");
    assert(created.controls.unavailable.includes("host-usage"), "unavailable controls remain visible");
    assert(fs.readFileSync(found.runPath, "utf8") === runBefore, "host ids never mutate core workflow state");

    const bindingPath = path.join(found.runRoot, "integration", "host-binding.json");
    assert(fs.existsSync(bindingPath), "host binding is persisted outside core run state");
    assert(loadHostBinding(found).workflow.runId === approved.runId, "persisted binding is readable");

    const wrongOwner = explicitBinding(approved.runId);
    wrongOwner.execution = { owner: "audit-only", backend: null };
    assertThrows(
      () => createHostBinding(found, wrongOwner, { capabilities: supportedSnapshot() }),
      /does not match workflow execution owner/,
      "binding cannot change execution ownership",
    );

    const falseAttachment = explicitBinding(approved.runId);
    falseAttachment.mode = "attached";
    falseAttachment.provenance.kind = "plugin-observed";
    falseAttachment.provenance.capabilitySchemaVersion = "codex-integration-capabilities/v1";
    assertThrows(
      () => createHostBinding(found, falseAttachment, { capabilities: supportedSnapshot(), replace: true }),
      /plugin path has not passed host observation capability tests/,
      "plugin cannot claim a live native attachment without a capability proof",
    );

    const managedRepo = makeTempRepo("cewp-integration-managed-binding-");
    try {
      const managed = approveWorkflow(managedRepo, validDefinition());
      const managedFound = loadWorkflowRun(managedRepo, managed.runId);
      const unsafe = explicitBinding(managed.runId);
      unsafe.execution = { owner: "managed", backend: "codex-exec" };
      assertThrows(
        () => createHostBinding(managedFound, unsafe, { capabilities: supportedSnapshot() }),
        /managed execution cannot bind to the ChatGPT desktop internal session/,
        "managed execution never attaches to desktop internals",
      );
    } finally {
      cleanupRepo(managedRepo);
    }

    const conflictRepo = makeTempRepo("cewp-integration-ownership-conflict-");
    try {
      const native = approveWorkflow(conflictRepo, nativeDefinition());
      let nativeFound = loadWorkflowRun(conflictRepo, native.runId);
      const started = startWorkflowTask(nativeFound, "implement-example", {
        now: new Date("2026-07-18T12:01:00.000Z"),
      });
      nativeFound = loadWorkflowRun(conflictRepo, native.runId);
      const sharedWorktree = path.join(conflictRepo, "..", ".cewp-worktrees", "shared-task");
      const managedOwnershipPath = path.join(
        conflictRepo,
        ".cewp",
        "supervised-runs",
        "managed-conflict",
        "ownership.json",
      );
      fs.mkdirSync(path.dirname(managedOwnershipPath), { recursive: true });
      fs.writeFileSync(managedOwnershipPath, `${JSON.stringify({
        schemaVersion: "execution-ownership/v1",
        runId: "managed-conflict",
        taskId: "implement-example",
        checkpointId: "implement-example",
        owner: "managed",
        backend: "codex-exec",
        status: "active",
        createdAt: "2026-07-18T12:00:00.000Z",
        cleanupAuthority: "cewp-core",
        worktree: { id: "shared-task", path: sharedWorktree },
      }, null, 2)}\n`);

      const conflictingBinding = explicitBinding(native.runId);
      conflictingBinding.workflow = {
        runId: native.runId,
        taskId: "implement-example",
        checkpointId: started.checkpoint.checkpointId,
      };
      conflictingBinding.references.worktree = { id: "shared-task", path: sharedWorktree };
      assertThrows(
        () => createHostBinding(nativeFound, conflictingBinding, { capabilities: supportedSnapshot() }),
        /execution ownership conflict/,
        "native host binding cannot claim an active managed task worktree",
      );
      assert(
        !fs.existsSync(path.join(nativeFound.runRoot, "integration", "host-binding.json")),
        "conflicting native binding is not persisted",
      );
    } finally {
      cleanupRepo(conflictRepo);
    }

    const coreRun = JSON.parse(fs.readFileSync(found.runPath, "utf8"));
    assert(coreRun.host === undefined && coreRun.references === undefined, "provider ids stay outside core schema");

    console.log("[PASS] host identity sidecar preserves ownership and honest native fallback");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  main();
} catch (error) {
  console.error("[FAIL] host integration binding contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
