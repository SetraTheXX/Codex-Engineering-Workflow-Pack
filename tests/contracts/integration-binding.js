"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode } = require("../harness/lib/temp-repo");
const { supportedSnapshot } = require("./integration-capabilities");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const {
  createGeneratedGoalBrief,
  createHostBinding,
  loadIntegrationControlReceipt,
  loadHostBinding,
} = require("../../src/integration/binding");
const { loadWorkflowRun, startWorkflowTask } = require("../../src/workflow/state");
const { buildEvidenceReceipt } = require("../../src/evidence/receipt");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

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

function auditDefinition() {
  const definition = validDefinition();
  definition.workflowId = "audit-integration";
  definition.execution = {
    owner: "audit-only",
    backend: null,
    allowedModes: ["audit-only"],
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

    const auditRepo = makeTempRepo("cewp-integration-audit-binding-");
    try {
      const audit = approveWorkflow(auditRepo, auditDefinition());
      const auditFound = loadWorkflowRun(auditRepo, audit.runId);
      const auditBinding = explicitBinding(audit.runId);
      auditBinding.execution = { owner: "audit-only", backend: null };
      auditBinding.host.surface = "external-client";
      auditBinding.mode = "audit-import";
      auditBinding.provenance.kind = "imported-audit";
      auditBinding.references.goalId = null;
      auditBinding.references.threadId = "external-thread-1";
      auditBinding.controls = {
        preventive: ["scope-policy"],
        postExecution: ["receipt-schema"],
        imported: ["external-scope-observation"],
        unavailable: ["provider-tool-prevention"],
      };
      assertThrows(
        () => createHostBinding(auditFound, auditBinding, { capabilities: supportedSnapshot() }),
        /audit-only.*preventive/i,
        "audit-only binding cannot claim preventive enforcement",
      );

      auditBinding.controls.preventive = [];
      createHostBinding(auditFound, auditBinding, { capabilities: supportedSnapshot() });
      const controlReceipt = loadIntegrationControlReceipt(auditFound);
      assert(controlReceipt.schemaVersion === "integration-control-receipt/v1", "control receipt is versioned");
      assert(controlReceipt.execution.owner === "audit-only", "receipt retains audit-only ownership");
      assert(controlReceipt.summary.preventiveEnforced === 0, "audit-only receipt claims no preventive enforcement");
      assert(controlReceipt.summary.postExecutionChecked === 1, "post-execution checks stay distinct");
      assert(
        controlReceipt.controls.find((entry) => entry.name === "receipt-schema").classification === "post-execution",
        "public receipt uses the documented post-execution classification",
      );
      assert(controlReceipt.summary.importedObserved === 1, "imported observations stay distinct");
      assert(
        controlReceipt.controls.find((entry) => entry.name === "external-scope-observation").effect === "observed-not-enforced",
        "imported audit evidence is labeled observed rather than enforced",
      );
      assert(
        controlReceipt.claims.providerExecutionSuppliesEnforcement === false,
        "audit receipt never treats provider-controlled execution as the enforcement source",
      );
      const auditEvidence = buildEvidenceReceipt(auditFound, { generatedAt: "2026-07-22T15:20:00.000Z" });
      const importedControl = auditEvidence.policy.controls.controls.find((entry) => entry.classification === "imported");
      assert(importedControl.effect === "observed-not-enforced", "audit-only evidence receipt preserves observed-not-enforced effect");
      assert(auditEvidence.policy.controls.summary.preventiveEnforced === 0, "audit-only evidence receipt never reports preventive enforcement");
      const shown = runNode(cewpCli, ["integration", "controls", audit.runId, "--json"], auditRepo);
      assert(shown.status === 0, `control receipt is available through operator JSON: ${shown.stderr}`);
      const shownReceipt = JSON.parse(shown.stdout);
      assert(shownReceipt.command === "integration.controls", "operator JSON identifies control inspection");
      assert(shownReceipt.data.summary.importedObserved === 1, "operator JSON preserves observed audit evidence");

      const duplicate = { ...auditBinding, controls: {
        ...auditBinding.controls,
        imported: ["receipt-schema"],
      } };
      assertThrows(
        () => createHostBinding(auditFound, duplicate, { capabilities: supportedSnapshot(), replace: true }),
        /more than one control class/,
        "one control cannot receive conflicting enforcement classifications",
      );

      const receiptPath = path.join(auditFound.runRoot, "integration", "control-receipt.json");
      const tampered = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      tampered.controls.find((entry) => entry.classification === "imported").effect = "prevented-before-execution";
      fs.writeFileSync(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`);
      assertThrows(
        () => loadIntegrationControlReceipt(auditFound),
        /does not match the validated host binding/,
        "edited receipt cannot promote observed audit evidence to enforcement",
      );
    } finally {
      cleanupRepo(auditRepo);
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
