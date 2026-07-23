"use strict";

const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode } = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const { loadWorkflowRun } = require("../../src/workflow/state");
const { buildEvidenceReceipt } = require("../../src/evidence/receipt");
const { compareEvidenceReceipts } = require("../../src/evidence/compare");
const { createHostBinding } = require("../../src/integration/binding");
const { supportedSnapshot } = require("./integration-capabilities");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function runContract() {
  const repoRoot = makeTempRepo("cewp-run-comparison-");
  try {
    const managedDefinition = validDefinition();
    managedDefinition.workflowId = "comparison-managed";
    const nativeDefinition = validDefinition();
    nativeDefinition.workflowId = "comparison-native";
    nativeDefinition.execution = { owner: "native", backend: null, allowedModes: ["supervised"] };
    const managed = approveWorkflow(repoRoot, managedDefinition);
    const native = approveWorkflow(repoRoot, nativeDefinition);
    const nativeFound = loadWorkflowRun(repoRoot, native.runId);
    createHostBinding(nativeFound, {
      schemaVersion: "host-binding/v1",
      workflow: { runId: native.runId, taskId: null, checkpointId: null },
      execution: { owner: "native", backend: null },
      host: { product: "codex", surface: "chatgpt-desktop", version: null },
      mode: "explicit-intake",
      provenance: {
        kind: "explicit-intake",
        capabilitySchemaVersion: null,
        authenticationBoundary: "host-owned",
        recordedAt: "2026-07-22T12:59:00.000Z",
      },
      references: { goalId: "native-goal-baseline-1", threadId: null, turnId: null, subagents: [], worktree: null },
      controls: { preventive: [], postExecution: [], imported: ["goal-reference"], unavailable: ["host-usage"] },
    }, { capabilities: supportedSnapshot() });
    const generatedAt = "2026-07-22T13:00:00.000Z";
    const left = buildEvidenceReceipt(loadWorkflowRun(repoRoot, managed.runId), { generatedAt });
    const right = buildEvidenceReceipt(loadWorkflowRun(repoRoot, native.runId), { generatedAt });
    const comparison = compareEvidenceReceipts(left, right);
    assert(comparison.schemaVersion === "run-comparison/v1", "run comparison is versioned");
    assert(comparison.runs.left.execution.owner === "managed" && comparison.runs.right.execution.owner === "native", "execution owner and backend are compared");
    assert(comparison.runs.right.nativeGoalBaseline === true, "native-owner run is labeled as a native-goal baseline");
    const unboundNative = compareEvidenceReceipts(left, {
      ...right,
      integration: { nativeGoal: { status: "unknown", goalId: null, reason: "no supported native goal binding" } },
    });
    assert(unboundNative.runs.right.nativeGoalBaseline === false, "native ownership alone does not claim a native-goal baseline");
    assert(comparison.dimensions.outcome.left.completeness === "partial", "outcomes remain explicit");
    assert(comparison.dimensions.duration.left.label === "unknown", "unfinished duration remains unknown");
    assert(comparison.dimensions.modelTime.right.label === "unknown", "unavailable native model time remains unknown");
    assert(comparison.dimensions.usage.managedTokens.right.label === "unknown", "unavailable native usage is not converted to zero");
    assert(comparison.dimensions.apiEquivalentCost.right.label === "unknown", "native subscription work does not invent currency cost");
    assert(comparison.dimensions.cewpOverhead.left.label === "unknown", "unobserved CEWP overhead remains unknown");
    assert(comparison.dimensions.attempts.left.label === "observed" && comparison.dimensions.attempts.left.value === 0, "structural zero attempts are observed, not inferred usage");
    assert(comparison.dimensions.commands.left.length > 0 && comparison.dimensions.verification.left.commandCount > 0, "commands and verification evidence are comparable");
    assert(comparison.equivalence.status === "partial" && comparison.equivalence.unavailable.includes("model-time"), "comparison explains unavailable dimensions");

    const cli = runNode(cewpCli, ["workflow", "compare", managed.runId, native.runId, "--json"], repoRoot);
    assert(cli.status === 0, `workflow compare CLI succeeds: ${cli.stderr}`);
    const output = JSON.parse(cli.stdout);
    assert(output.command === "workflow.compare" && output.data.schemaVersion === "run-comparison/v1", "CLI exposes the shared comparison model");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] honest managed and native run comparison");
} catch (error) {
  console.error("[FAIL] run comparison contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
