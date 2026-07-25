"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, readJson, runNode, writeJson } = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function runContract() {
  const repoRoot = makeTempRepo("cewp-pilot-record-");
  try {
    const created = runNode(cewpCli, [
      "pilot", "create",
      "--pilot-id", "dogfood-1",
      "--participant", "maintainer-dogfood",
      "--participant-id", "maintainer-1",
      "--json",
    ], repoRoot);
    assert(created.status === 0, `pilot create succeeds: ${created.stderr}`);
    const output = JSON.parse(created.stdout);
    assert(output.command === "pilot.create", "pilot create has a stable command envelope");
    assert(output.data.schemaVersion === "pilot-record/v1", "pilot record is versioned");
    assert(output.data.pilotId === "dogfood-1", "pilot id is explicit and stable");
    assert(output.data.participant.classification === "maintainer-dogfood", "maintainer evidence is classified honestly");
    assert(output.data.participant.id === "maintainer-1", "privacy-safe participant id is retained");

    const recordPath = path.join(repoRoot, ".cewp", "pilots", "dogfood-1", "record.json");
    assert(fs.existsSync(recordPath), "canonical pilot record stays under ignored local runtime state");
    assert(readJson(recordPath).pilotId === "dogfood-1", "persisted pilot record matches CLI output");

    const statusResult = runNode(cewpCli, ["pilot", "status", "--json"], repoRoot);
    assert(statusResult.status === 1, "incomplete Phase 13 status exits nonzero");
    const status = JSON.parse(statusResult.stdout);
    assert(status.command === "pilot.status", "pilot status has a stable command envelope");
    assert(status.data.schemaVersion === "pilot-status/v1", "pilot status is versioned");
    assert(status.data.complete === false, "maintainer dogfood cannot complete Phase 13");
    assert(status.data.participants.maintainerDogfood === 1, "maintainer dogfood is visible");
    assert(status.data.participants.independentExternal === 0, "maintainer dogfood is excluded from independent participants");
    const externalGate = status.data.gates.find((gate) => gate.id === "independent-external-participants");
    const repositoryGate = status.data.gates.find((gate) => gate.id === "independent-repository-attempts");
    const reviewedGate = status.data.gates.find((gate) => gate.id === "full-reviewed-runs");
    assert(externalGate.threshold === 3 && externalGate.observed === 0 && externalGate.status === "unmet", "three independent participants remain required");
    assert(repositoryGate.threshold === 10 && repositoryGate.observed === 0, "ten repository attempts remain required");
    assert(reviewedGate.threshold === 5 && reviewedGate.observed === 0, "five reviewed runs remain required");
    assert(status.data.exclusions.some((entry) => entry.pilotId === "dogfood-1"), "excluded maintainer evidence is explained");

    const duplicate = runNode(cewpCli, [
      "pilot", "create",
      "--pilot-id", "dogfood-1",
      "--participant", "maintainer-dogfood",
      "--participant-id", "maintainer-1",
      "--json",
    ], repoRoot);
    assert(duplicate.status === 1 && duplicate.stderr.includes("already exists"), "duplicate pilot ids fail closed");

    const traversal = runNode(cewpCli, [
      "pilot", "create",
      "--pilot-id", "../escape",
      "--participant", "maintainer-dogfood",
      "--participant-id", "maintainer-1",
      "--json",
    ], repoRoot);
    assert(traversal.status === 1 && traversal.stderr.includes("--pilot-id"), "unsafe pilot ids are rejected before a path is created");

    const fabricatedClass = runNode(cewpCli, [
      "pilot", "create",
      "--pilot-id", "fake-external",
      "--participant", "external-ish",
      "--participant-id", "person-1",
      "--json",
    ], repoRoot);
    assert(fabricatedClass.status === 1 && fabricatedClass.stderr.includes("independent-external"), "unsupported participant classifications fail closed");
    assert(!fs.existsSync(path.resolve(repoRoot, "..", "escape")), "unsafe pilot ids cannot escape the local pilot root");

    writeJson(path.join(repoRoot, ".cewp", "pilots", "incompatible", "record.json"), {
      schemaVersion: "pilot-record/v999",
      pilotId: "incompatible",
    });
    const malformedRoot = path.join(repoRoot, ".cewp", "pilots", "malformed");
    fs.mkdirSync(malformedRoot, { recursive: true });
    fs.writeFileSync(path.join(malformedRoot, "record.json"), "{not-json\n");
    const failSafeStatus = runNode(cewpCli, ["pilot", "status", "--json"], repoRoot);
    assert(failSafeStatus.status === 1, "invalid local pilot records keep Phase 13 incomplete");
    const inspected = JSON.parse(failSafeStatus.stdout).data;
    assert(inspected.records.valid === 1 && inspected.records.invalid === 2, "status distinguishes valid and invalid pilot records");
    assert(inspected.warnings.filter((entry) => entry.code === "pilot-record-invalid").length === 2, "each invalid pilot record has a reviewable fail-safe warning");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] local pilot record creation");
} catch (error) {
  console.error("[FAIL] local pilot record creation");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
