"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode, writeFile, writeJson } = require("../harness/lib/temp-repo");
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
const { writeEvidenceReceipt } = require("../../src/evidence/receipt");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function createPilot(repoRoot, pilotId) {
  const result = runNode(cewpCli, [
    "pilot", "create",
    "--pilot-id", pilotId,
    "--participant", "maintainer-dogfood",
    "--participant-id", `maintainer-${pilotId.slice(-1)}`,
    "--json",
  ], repoRoot);
  assert(result.status === 0, `pilot ${pilotId} is created: ${result.stderr}`);
}

function completeRun(repoRoot, index) {
  const definition = validDefinition();
  definition.workflowId = `pilot-reviewed-${index}`;
  definition.tasks = [definition.tasks[0]];
  definition.budget.maxTargetedVerificationRuns = 6;
  definition.budget.maxFullVerificationRuns = 1;
  const approved = approveWorkflow(repoRoot, definition);
  const approvedAt = Date.parse(approved.createdAt);
  let found = loadWorkflowRun(repoRoot, approved.runId);
  const started = startWorkflowTask(found, "implement-example", {
    now: new Date(approvedAt + 60_000),
  });
  const paths = {
    baseline: `evidence/pilot-${index}-baseline.json`,
    targeted: `evidence/pilot-${index}-targeted.json`,
    artifact: `evidence/pilot-${index}-change.diff`,
    review: `evidence/pilot-${index}-review.md`,
  };
  writeFile(path.join(repoRoot, paths.baseline), "{\"status\":\"passed\"}\n");
  writeFile(path.join(repoRoot, paths.targeted), "{\"status\":\"passed\"}\n");
  writeFile(path.join(repoRoot, paths.artifact), "diff --git a/src/example.js b/src/example.js\n");
  writeFile(path.join(repoRoot, paths.review), "# Independent review\n\nPASS\n");
  const result = successfulResult(approved, started.checkpoint, [{
    command: "node --test tests/example.test.js",
    status: "passed",
    evidencePath: paths.targeted,
  }]);
  result.verification.baseline.evidence[0].evidencePath = paths.baseline;
  result.artifacts[0].path = paths.artifact;
  recordWorkflowResult(loadWorkflowRun(repoRoot, approved.runId), "implement-example", result);
  const run = loadWorkflowRun(repoRoot, approved.runId).run;
  recordWorkflowReview(loadWorkflowRun(repoRoot, approved.runId), {
    schemaVersion: "review-result/v1",
    reviewId: `${run.runId}-final-review`,
    runId: run.runId,
    workflowDigest: run.workflow.digest,
    scope: { kind: "workflow", taskId: null, checkpointId: null },
    completedAt: new Date(approvedAt + 120_000).toISOString(),
    independent: true,
    decision: "PASS",
    summary: "Independent pilot review passed.",
    findings: [],
    evidence: [{ kind: "review-report", path: paths.review }],
    usage: {
      managedOperations: { label: "observed", value: 1, source: "codex-exec-jsonl" },
      capturedOutputBytes: { label: "observed", value: 64, source: "cewp-bounded-output" },
      managedTokens: { label: "unknown", value: null, reason: "fixture omits token totals" },
      hostInternal: { label: "unknown", value: null, reason: "host usage unavailable" },
    },
  });
  finalizeWorkflowRun(loadWorkflowRun(repoRoot, approved.runId), {
    now: new Date(approvedAt + 180_000),
  });
  const finalized = loadWorkflowRun(repoRoot, approved.runId);
  writeEvidenceReceipt(finalized, { generatedAt: new Date(approvedAt + 240_000).toISOString() });
  return { found: loadWorkflowRun(repoRoot, approved.runId), paths };
}

function reviewedObservation(observationId, workflowRunId) {
  return {
    schemaVersion: "pilot-observation/v1",
    observationId,
    type: "full-reviewed-run",
    observedAt: "2026-07-22T07:00:00.000Z",
    run: { workflowRunId },
  };
}

function supervisedReviewedObservation(observationId, supervisedRunId) {
  return {
    schemaVersion: "pilot-observation/v1",
    observationId,
    type: "full-reviewed-run",
    observedAt: "2026-07-22T07:30:00.000Z",
    run: { supervisedRunId },
  };
}

function completeSupervisedRun(repoRoot, runId) {
  const runRoot = path.join(repoRoot, ".cewp", "supervised-runs", runId);
  writeJson(path.join(runRoot, "run.json"), {
    schemaVersion: "supervised-run/v1",
    runId,
    status: "completed",
    reviewer: { independent: true, status: "passed", decision: "PASS" },
    receipt: { status: "finalized" },
    tasks: [{
      id: "checkpoint-1",
      status: "completed",
      verification: { latest: { status: "pass" }, scope: { status: "pass" } },
      evidence: [
        { type: "verification", verificationIds: ["targeted-1"], scopeStatus: "pass" },
        { type: "independent-review", decision: "PASS", path: "review/reviewer-report.md" },
      ],
    }],
  });
  writeJson(path.join(runRoot, "receipt.json"), {
    schemaVersion: "supervised-receipt/v1-beta",
    runId,
    status: "completed",
    finalized: true,
    reviewer: { independent: true, status: "passed", decision: "PASS" },
  });
  writeJson(path.join(runRoot, "ownership.json"), {
    schemaVersion: "execution-ownership/v1",
    runId,
    taskId: "checkpoint-1",
    checkpointId: "checkpoint-1",
    owner: "managed",
    backend: "codex-exec",
    status: "released",
    worktree: { id: `${runId}-checkpoint-1`, path: "worktrees/checkpoint-1" },
  });
}

function recordObservation(repoRoot, pilotId, observation) {
  const fileName = `${observation.observationId}.json`;
  writeJson(path.join(repoRoot, fileName), observation);
  return runNode(cewpCli, ["pilot", "record", pilotId, "--from", fileName, "--yes", "--json"], repoRoot);
}

function runContract() {
  const repoRoot = makeTempRepo("cewp-pilot-receipt-link-");
  try {
    createPilot(repoRoot, "external-1");
    const complete = completeRun(repoRoot, 1);
    const linked = recordObservation(repoRoot, "external-1", reviewedObservation("reviewed-run-1", complete.found.run.runId));
    assert(linked.status === 0, `complete reviewed run is linked: ${linked.stderr}`);
    const linkedObservation = JSON.parse(linked.stdout).data.observation;
    assert(linkedObservation.qualification.eligible === true, "complete receipt-linked run qualifies");
    assert(linkedObservation.evidence.receipt.schemaVersion === "evidence-receipt/v1", "link retains receipt contract identity");
    assert(/^sha256:[a-f0-9]{64}$/.test(linkedObservation.evidence.receipt.sha256), "link retains receipt digest without copying raw evidence");
    assert(linkedObservation.evidence.rawEvidenceCopied === false, "pilot link never copies raw workflow evidence");

    const partialDefinition = validDefinition();
    partialDefinition.workflowId = "pilot-partial";
    const partial = approveWorkflow(repoRoot, partialDefinition);
    const partialLink = recordObservation(repoRoot, "external-1", reviewedObservation("reviewed-run-partial", partial.runId));
    assert(partialLink.status === 0, `partial run remains recordable: ${partialLink.stderr}`);
    const partialObservation = JSON.parse(partialLink.stdout).data.observation;
    assert(partialObservation.qualification.eligible === false, "partial run cannot qualify the reviewed-run gate");
    assert(partialObservation.qualification.reason.includes("not finalized"), "partial run exclusion is actionable");

    const status = JSON.parse(runNode(cewpCli, ["pilot", "status", "--json"], repoRoot).stdout).data;
    const reviewedGate = status.gates.find((gate) => gate.id === "full-reviewed-runs");
    assert(reviewedGate.observed === 1 && reviewedGate.remaining === 0, "only the complete reviewed run counts and it satisfies the technical gate");

    const tampered = completeRun(repoRoot, 2);
    fs.appendFileSync(path.join(repoRoot, tampered.paths.targeted), "tampered\n");
    const tamperedLink = recordObservation(repoRoot, "external-1", reviewedObservation("reviewed-run-tampered", tampered.found.run.runId));
    assert(tamperedLink.status === 0, "tampered run remains inspectable as excluded evidence");
    const tamperedObservation = JSON.parse(tamperedLink.stdout).data.observation;
    assert(tamperedObservation.qualification.eligible === false, "receipt integrity failure cannot qualify");
    assert(tamperedObservation.evidence.verification.status === "failed", "integrity failure is retained in linked evidence");

    for (let index = 3; index <= 6; index += 1) {
      const completed = completeRun(repoRoot, index);
      const recorded = recordObservation(repoRoot, "external-1", reviewedObservation(`reviewed-run-${index}`, completed.found.run.runId));
      assert(recorded.status === 0 && JSON.parse(recorded.stdout).data.observation.qualification.eligible === true, `reviewed run ${index} qualifies`);
    }
    const completedStatus = JSON.parse(runNode(cewpCli, ["pilot", "status", "--json"], repoRoot).stdout).data;
    const completedGate = completedStatus.gates.find((gate) => gate.id === "full-reviewed-runs");
    assert(completedGate.observed === 5 && completedGate.threshold === 1 && completedGate.status === "met", "one verified reviewed run satisfies the technical acceptance threshold while all evidence remains visible");

    createPilot(repoRoot, "supervised-1");
    completeSupervisedRun(repoRoot, "20260722-073000");
    const supervisedLink = recordObservation(repoRoot, "supervised-1", supervisedReviewedObservation("supervised-reviewed-1", "20260722-073000"));
    assert(supervisedLink.status === 0, `finalized supervised run is linkable: ${supervisedLink.stderr}`);
    const supervisedEvidence = JSON.parse(supervisedLink.stdout).data.observation;
    assert(supervisedEvidence.qualification.eligible === true, "finalized supervised receipt qualifies");
    assert(supervisedEvidence.evidence.runKind === "supervised", "linked evidence identifies the supervised run kind");
    assert(supervisedEvidence.evidence.reviewer.independentPass === true, "supervised link preserves independent reviewer PASS");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] pilot reviewed-run links require complete verified receipts");
} catch (error) {
  console.error("[FAIL] pilot reviewed-run receipt links");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
