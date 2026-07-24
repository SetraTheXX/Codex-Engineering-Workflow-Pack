"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode, writeFile } = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { successfulResult } = require("./workflow-result");
const { approveWorkflow } = require("./workflow-scheduler");
const {
  finalizeWorkflowRun,
  loadWorkflowRun,
  recordWorkflowResult,
  recordWorkflowReview,
  startWorkflowTask,
} = require("../../src/workflow/state");
const {
  buildEvidenceReceipt,
  renderEvidenceReceiptMarkdown,
  writeEvidenceReceipt,
} = require("../../src/evidence/receipt");
const { recordHostObservation } = require("../../src/integration/observation");
const { supportedSnapshot } = require("./integration-capabilities");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function singleTaskDefinition() {
  const definition = validDefinition();
  definition.workflowId = "evidence-receipt";
  definition.tasks = [definition.tasks[0]];
  definition.budget.maxTargetedVerificationRuns = 6;
  definition.budget.maxFullVerificationRuns = 1;
  return definition;
}

function reviewerCandidate(run) {
  return {
    schemaVersion: "review-result/v1",
    reviewId: `${run.runId}-final-review`,
    runId: run.runId,
    workflowDigest: run.workflow.digest,
    scope: { kind: "workflow", taskId: null, checkpointId: null },
    completedAt: "2026-07-18T12:05:00.000Z",
    independent: true,
    decision: "PASS",
    summary: "Independent evidence receipt review passed.",
    findings: [],
    evidence: [{ kind: "review-report", path: "evidence/review.md" }],
    usage: {
      managedOperations: { label: "observed", value: 1, source: "codex-exec-jsonl" },
      capturedOutputBytes: { label: "observed", value: 128, source: "cewp-bounded-output" },
      managedTokens: { label: "unknown", value: null, reason: "fixture omits token totals" },
      hostInternal: { label: "unknown", value: null, reason: "host usage is unavailable" },
    },
  };
}

function completeRun(repoRoot) {
  const approved = approveWorkflow(repoRoot, singleTaskDefinition());
  let found = loadWorkflowRun(repoRoot, approved.runId);
  const started = startWorkflowTask(found, "implement-example", {
    now: new Date("2026-07-18T12:00:00.000Z"),
  });
  writeFile(path.join(repoRoot, "evidence", "baseline.json"), "{\"status\":\"passed\"}\n");
  writeFile(path.join(repoRoot, "evidence", "targeted.json"), "{\"status\":\"passed\"}\n");
  writeFile(path.join(repoRoot, "evidence", "change.diff"), "diff --git a/src/example.js b/src/example.js\n");
  writeFile(path.join(repoRoot, "evidence", "review.md"), "# Independent review\n\nPASS\n");
  const result = successfulResult(approved, started.checkpoint, [{
    command: "node --test tests/example.test.js",
    status: "passed",
    evidencePath: "evidence/targeted.json",
  }]);
  found = loadWorkflowRun(repoRoot, approved.runId);
  recordWorkflowResult(found, "implement-example", result);
  found = loadWorkflowRun(repoRoot, approved.runId);
  recordWorkflowReview(found, reviewerCandidate(approved));
  found = loadWorkflowRun(repoRoot, approved.runId);
  finalizeWorkflowRun(found, { now: new Date("2026-07-18T12:06:00.000Z") });
  return loadWorkflowRun(repoRoot, approved.runId);
}

function runContract() {
  const repoRoot = makeTempRepo("cewp-evidence-receipt-");
  try {
    const found = completeRun(repoRoot);
    recordHostObservation(found, {
      schemaVersion: "host-observation/v1",
      observationId: "receipt-usage-0001",
      observedAt: "2026-07-18T12:06:30.000Z",
      source: {
        path: "codex-exec",
        codexVersion: "codex-cli 0.137.0",
        schemaVersion: "codex-exec-jsonl/v1",
        authenticationBoundary: "managed-child",
      },
      scope: { kind: "workflow-run", runId: found.run.runId, taskId: null, checkpointId: null },
      category: "thread-usage",
      rawCategory: "turn.completed.usage",
      availability: "observed",
      data: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningOutputTokens: 5 },
      raw: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 },
    }, { capabilities: supportedSnapshot() });
    recordHostObservation(found, {
      schemaVersion: "host-observation/v1",
      observationId: "receipt-usage-imported-0001",
      observedAt: "2026-07-18T12:06:31.000Z",
      source: {
        path: "audit-import",
        codexVersion: null,
        schemaVersion: "external-receipt/v1",
        authenticationBoundary: "external-owner",
      },
      scope: { kind: "workflow-run", runId: found.run.runId, taskId: null, checkpointId: null },
      category: "thread-usage",
      rawCategory: "external.usage",
      availability: "imported",
      data: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 },
      raw: { imported_total: 60 },
    }, { capabilities: supportedSnapshot() });
    writeFile(path.join(found.runRoot, "adapter-output", "prompt.md"), "TOP_SECRET_PROMPT\n");
    const options = { generatedAt: "2026-07-18T12:07:00.000Z" };
    const first = buildEvidenceReceipt(found, options);
    const second = buildEvidenceReceipt(found, options);
    assert(first.schemaVersion === "evidence-receipt/v1", "evidence receipt is versioned");
    assert(JSON.stringify(first) === JSON.stringify(second), "fixed-timestamp receipt generation is deterministic");
    assert(first.completeness.status === "complete", "finalized reviewed run produces a complete receipt");
    assert(first.goal === found.run.goal, "receipt retains the approved goal");
    assert(first.sourcePlan.kind === "direct-goal", "receipt retains source-plan identity");
    assert(first.execution.owner === "managed" && first.execution.backend === "codex-exec", "receipt retains owner and backend");
    assert(first.tasks.length === 1 && first.checkpoints.length === 1, "receipt explains task and checkpoint structure");
    assert(first.tasks[0].changedFiles.includes("src/example.js"), "receipt records changed files");
    assert(first.tasks[0].verification.targeted[0].status === "passed", "receipt records verification evidence");
    assert(first.reviewer.decision === "PASS", "receipt retains independent reviewer PASS");
    assert(first.usage.managedOperations.label === "observed", "receipt aggregates observed managed operations");
    assert(first.usage.hostInternal.label === "unknown", "unavailable host usage remains unknown");
    assert(first.usage.observations.every((entry) => entry.schemaVersion === "usage-observation/v1"), "usage observations are independently versioned");
    const hostUsage = first.usage.observations.find((entry) => entry.rawCategory === "turn.completed.usage");
    assert(hostUsage.source.authenticationBoundary === "managed-child", "usage observation preserves authentication boundary");
    assert(hostUsage.value.cachedInputTokens === 40 && hostUsage.value.reasoningOutputTokens === 5, "raw usage categories remain distinct");
    assert(hostUsage.rawValue === null, "receipt excludes raw host payload while preserving normalized categories");
    const importedUsage = first.usage.observations.find((entry) => entry.rawCategory === "external.usage");
    assert(importedUsage.availability === "imported" && importedUsage.evidenceClass === "imported", "imported usage is never relabeled observed");
    assert(importedUsage.billingImpact === "unknown", "host usage never implies a billing impact");
    assert(first.events.some((entry) => entry.type === "usage-observed" && entry.category === "usage-observation"), "usage recording emits the versioned lifecycle category");
    assert(first.estimate.estimator.version === "local-history/v1" && first.estimate.sampleBasis.count === 0, "unknown estimate remains reproducible from its empty sample basis");
    assert(first.estimate.calibrationSnapshot.intervalCoverage === null && first.estimate.drift.state === "unknown", "estimate calibration and drift stay explicit");
    assert(first.budget.compliance.status === "passed", "receipt proves the approved budget ceilings were respected");
    assert(first.budget.compliance.protectedAllocationsRespected === true, "receipt proves protected allocations were not overspent");
    assert(first.cost.apiEquivalent.label === "unknown", "currency cost is not invented");
    assert(first.integrity.claim === "tamper-evident-local-metadata", "integrity claim is explicitly local and tamper-evident");
    assert(first.integrity.files.length > 3, "receipt hashes canonical evidence files");
    assert(first.integrity.files.every((entry) => /^sha256:[a-f0-9]{64}$/.test(entry.sha256)), "evidence file hashes are stable sha256 values");
    assert(first.integrity.files.map((entry) => entry.path).join("\n") === first.integrity.files.map((entry) => entry.path).sort().join("\n"), "integrity inventory is sorted");
    assert(first.git.baseCommit.status === "known" && first.git.headCommit.status === "known", "receipt records source git identities");

    const markdown = renderEvidenceReceiptMarkdown(first);
    assert(markdown.includes("# CEWP Evidence Receipt"), "Markdown receipt is human-readable");
    assert(markdown.includes("Host-internal usage: unknown"), "Markdown keeps explicit unknowns");
    assert(!markdown.includes("TOP_SECRET_PROMPT"), "Markdown does not include prompt or raw log content");
    const written = writeEvidenceReceipt(found, options);
    assert(fs.existsSync(written.paths.json) && fs.existsSync(written.paths.markdown), "JSON and Markdown receipts are written locally");
    assert(JSON.stringify(written.receipt) === JSON.stringify(first), "written receipt uses the same normalized model");
    const cli = runNode(cewpCli, ["workflow", "receipt", found.run.runId, "--json"], repoRoot);
    assert(cli.status === 0, `workflow receipt CLI succeeds: ${cli.stderr}`);
    const cliOutput = JSON.parse(cli.stdout);
    assert(cliOutput.command === "workflow.receipt", "receipt output uses operator JSON");
    assert(cliOutput.data.receipt.schemaVersion === "evidence-receipt/v1", "CLI writes the normalized receipt contract");

    fs.rmSync(path.join(repoRoot, "evidence", "change.diff"));
    const missingEvidence = buildEvidenceReceipt(found, options);
    assert(missingEvidence.completeness.status === "partial", "missing referenced evidence closes receipt completeness");
    assert(missingEvidence.warnings.some((warning) => warning.code === "missing-referenced-evidence"), "missing evidence has an actionable warning");
    fs.appendFileSync(path.join(found.runRoot, "integration", "host-observations.jsonl"), "{malformed\n");
    const malformedUsage = buildEvidenceReceipt(found, options);
    assert(malformedUsage.completeness.status === "partial", "malformed usage ledger cannot produce a complete receipt");
    assert(malformedUsage.warnings.some((warning) => warning.code === "malformed-usage-observation-ledger"), "malformed usage ledger has an explicit warning");

    const partialRepo = makeTempRepo("cewp-evidence-receipt-partial-");
    try {
      const partialRun = approveWorkflow(partialRepo, singleTaskDefinition());
      const partial = buildEvidenceReceipt(loadWorkflowRun(partialRepo, partialRun.runId), options);
      assert(partial.completeness.status === "partial", "incomplete historical run produces a partial receipt");
      assert(partial.warnings.some((warning) => warning.code === "run-not-finalized"), "partial receipt explains why it is incomplete");
    } finally {
      cleanupRepo(partialRepo);
    }
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] normalized evidence receipt is deterministic and tamper-evident");
} catch (error) {
  console.error("[FAIL] evidence receipt contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
