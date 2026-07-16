"use strict";

const path = require("node:path");
const {
  assert,
  assertExit,
} = require("../harness/lib/assertions");
const {
  cleanupRepo,
  latestRunId,
  makeTempRepo,
  runNode,
  writeFile,
} = require("../harness/lib/temp-repo");

const cewpRoot = path.resolve(__dirname, "..", "..");
const cewpCli = path.join(cewpRoot, "bin", "cewp.js");

function cewp(args, cwd) {
  return runNode(cewpCli, args, cwd);
}

function parseEnvelope(result, command) {
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${command} returned invalid JSON: ${error.message}\n${result.stdout}`);
  }

  assert(envelope.schemaVersion === "operator-json/v1", `${command} schema version`);
  assert(envelope.command === command, `${command} envelope command`);
  assert(!Number.isNaN(Date.parse(envelope.generatedAt)), `${command} generatedAt`);
  assert(envelope.data.command === command, `${command} data command`);
  assert(Array.isArray(envelope.warnings), `${command} warnings`);
  return envelope;
}

function findArtifact(inventory, predicate, label) {
  const artifact = inventory.find(predicate);
  assert(artifact, label);
  return artifact;
}

function runOperatorContract() {
  const repoRoot = makeTempRepo("cewp-operator-contract-");

  try {
    const init = cewp(["run", "init", "--workers", "2", "--reviewer"], repoRoot);
    assertExit(init, 0, "operator contract run init");
    const runId = latestRunId(repoRoot);
    assert(runId, "operator contract run id");
    const runRoot = path.join(repoRoot, ".cewp", "runs", runId);

    writeFile(
      path.join(runRoot, "reports", "worker-a-report.md"),
      "# Worker Report\n\nRole: worker-a\nStatus: ready_for_review\n",
    );
    writeFile(path.join(runRoot, "review-packets", "review-packet.md"), "# Review Packet\n");
    writeFile(
      path.join(runRoot, "reviews", "reviewer-report.md"),
      "# Reviewer Report\n\nDecision: PASS\n",
    );
    writeFile(
      path.join(runRoot, "events", "timeline.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-07-16T10:00:00.000Z",
          role: "worker-a",
          event: "checkpoint_verified",
          message: "Checkpoint verified.",
        }),
        "{ malformed timeline event",
        JSON.stringify({
          time: "2026-07-16T10:01:00.000Z",
          role: "reviewer",
          type: "review_completed",
          summary: "Reviewer passed the run.",
        }),
        "",
      ].join("\n"),
    );

    const status = cewp(["run", "status", "--run", runId, "--json"], repoRoot);
    assertExit(status, 0, "operator status JSON");
    const statusEnvelope = parseEnvelope(status, "run status");
    const statusData = statusEnvelope.data;
    assert(statusData.runId === runId, "operator status run id");
    assert(statusData.reviewer.pass === true, "operator status reviewer PASS");
    assert(statusData.nextAction.label === "finalize-dry-run", "operator status next action");

    const workerReport = findArtifact(
      statusData.artifacts.inventory,
      (artifact) => artifact.type === "worker-report" && artifact.role === "worker-a",
      "worker-a report inventory entry",
    );
    assert(workerReport.present === true, "worker-a report present");
    assert(typeof workerReport.sizeBytes === "number", "worker-a report size");

    const missingWorkerReport = findArtifact(
      statusData.artifacts.inventory,
      (artifact) => artifact.type === "worker-report" && artifact.role === "worker-b",
      "worker-b report inventory entry",
    );
    assert(missingWorkerReport.present === false, "worker-b report remains missing");
    assert(missingWorkerReport.mtime === null, "missing report has null mtime");

    const eventArtifact = findArtifact(
      statusData.artifacts.inventory,
      (artifact) => artifact.type === "event-file" && artifact.path === "events/timeline.jsonl",
      "timeline artifact entry",
    );
    assert(eventArtifact.present === true, "timeline artifact present");
    assert(statusData.timeline.malformedCount === 1, "malformed timeline count");
    assert(
      statusData.timeline.events.some((event) => event.type === "checkpoint_verified"),
      "normalized timeline event",
    );
    assert(
      statusData.timeline.events.some((event) => event.type === "malformed-event"),
      "malformed timeline event",
    );
    assert(
      statusEnvelope.warnings.some((warning) => warning.source === "events/timeline.jsonl"),
      "timeline warning is promoted to the operator envelope",
    );

    const resume = cewp(["run", "resume", "--run", runId, "--json"], repoRoot);
    assertExit(resume, 0, "operator resume JSON");
    const resumeEnvelope = parseEnvelope(resume, "run resume");
    assert(resumeEnvelope.data.reviewer.pass === true, "operator resume reviewer PASS");
    assert(
      resumeEnvelope.data.resume.recommendedCommand === `cewp run finalize --run ${runId} --dry-run`,
      "operator resume recommendation",
    );
    assert(resumeEnvelope.data.timeline.malformedCount === 1, "operator resume timeline contract");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runOperatorContract();
  console.log("[PASS] operator JSON, artifact inventory, and timeline contracts");
} catch (error) {
  console.error("[FAIL] operator JSON, artifact inventory, and timeline contracts");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
