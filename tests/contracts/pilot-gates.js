"use strict";

const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode, writeJson } = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function createPilot(repoRoot, pilotId, participant, participantId) {
  const result = runNode(cewpCli, [
    "pilot", "create",
    "--pilot-id", pilotId,
    "--participant", participant,
    "--participant-id", participantId,
    "--json",
  ], repoRoot);
  assert(result.status === 0, `pilot ${pilotId} is created: ${result.stderr}`);
}

function repositoryAttempt(observationId, attemptId) {
  return {
    schemaVersion: "pilot-observation/v1",
    observationId,
    type: "repository-attempt",
    observedAt: "2026-07-22T02:00:00.000Z",
    attempt: {
      id: attemptId,
      repositoryId: attemptId,
      language: "javascript",
      sizeBucket: "small",
      operatingSystem: "windows",
      testStack: "node",
      inputKind: "direct-goal",
      riskLevel: "low",
      mode: "supervised",
    },
  };
}

function goldenPath(observationId) {
  return {
    schemaVersion: "pilot-observation/v1",
    observationId,
    type: "golden-path-complete",
    observedAt: "2026-07-22T03:00:00.000Z",
    completion: {
      supervised: true,
      completed: true,
      participantConfirmed: true,
      firstApprovalMinutes: 4,
    },
  };
}

function boundedExternalTask(observationId) {
  return {
    schemaVersion: "pilot-observation/v1",
    observationId,
    type: "bounded-external-task",
    observedAt: "2026-07-22T04:00:00.000Z",
    task: {
      bounded: true,
      realRepository: true,
      acceptanceDefinedBeforeExecution: true,
    },
  };
}

function recordObservation(repoRoot, pilotId, relativePath) {
  return runNode(cewpCli, [
    "pilot", "record", pilotId,
    "--from", relativePath,
    "--yes",
    "--json",
  ], repoRoot);
}

function recordInline(repoRoot, pilotId, observation) {
  const fileName = `${observation.observationId}.json`;
  writeJson(path.join(repoRoot, fileName), observation);
  const result = recordObservation(repoRoot, pilotId, fileName);
  assert(result.status === 0, `${observation.type} is recorded: ${result.stderr}`);
  return JSON.parse(result.stdout).data.observation;
}

function evidence(observationId, type, field, value, minute = 5) {
  return {
    schemaVersion: "pilot-observation/v1",
    observationId,
    type,
    observedAt: `2026-07-22T05:${String(minute).padStart(2, "0")}:00.000Z`,
    [field]: value,
  };
}

function runContract() {
  const repoRoot = makeTempRepo("cewp-pilot-gates-");
  try {
    createPilot(repoRoot, "external-1", "independent-external", "person-1");
    createPilot(repoRoot, "dogfood-1", "maintainer-dogfood", "maintainer-1");
    writeJson(path.join(repoRoot, "external-attempt.json"), repositoryAttempt("external-attempt-1", "repo-attempt-1"));
    writeJson(path.join(repoRoot, "dogfood-attempt.json"), repositoryAttempt("dogfood-attempt-1", "repo-attempt-dogfood"));

    const external = recordObservation(repoRoot, "external-1", "external-attempt.json");
    assert(external.status === 0, `external observation is recorded: ${external.stderr}`);
    const externalOutput = JSON.parse(external.stdout).data;
    assert(externalOutput.observation.qualification.eligible === true, "valid independent observation is eligible");

    const dogfood = recordObservation(repoRoot, "dogfood-1", "dogfood-attempt.json");
    assert(dogfood.status === 0, `dogfood observation is recorded: ${dogfood.stderr}`);
    const dogfoodOutput = JSON.parse(dogfood.stdout).data;
    assert(dogfoodOutput.observation.qualification.eligible === true, "maintainer observation qualifies for technical acceptance");

    const statusResult = runNode(cewpCli, ["pilot", "status", "--json"], repoRoot);
    const status = JSON.parse(statusResult.stdout).data;
    const repositoryGate = status.gates.find((gate) => gate.id === "maintainer-repository-attempt");
    assert(repositoryGate.observed === 2, "maintainer and external repository attempts remain honestly classified and count as technical evidence");
    assert(repositoryGate.qualifyingEvidence.includes("repo-attempt-dogfood"), "privacy-safe maintainer repository identity makes evidence reviewable");

    createPilot(repoRoot, "external-2", "independent-external", "person-2");
    createPilot(repoRoot, "external-3", "independent-external", "person-3");
    for (const [pilotId, fileName] of [
      ["external-1", "golden-1.json"],
      ["external-2", "golden-2.json"],
      ["external-3", "golden-3.json"],
    ]) {
      writeJson(path.join(repoRoot, fileName), goldenPath(`golden-${pilotId}`));
      const recorded = recordObservation(repoRoot, pilotId, fileName);
      assert(recorded.status === 0, `${pilotId} golden path is recorded: ${recorded.stderr}`);
    }
    const afterGolden = JSON.parse(runNode(cewpCli, ["pilot", "status", "--json"], repoRoot).stdout).data;
    const goldenGate = afterGolden.gates.find((gate) => gate.id === "supervised-golden-path");
    assert(goldenGate.observed === 3 && goldenGate.status === "met", "a supervised golden path satisfies its technical gate");
    assert(afterGolden.complete === false, "golden-path completion alone cannot complete technical acceptance");

    writeJson(path.join(repoRoot, "bounded-task.json"), boundedExternalTask("bounded-task-1"));
    const bounded = recordObservation(repoRoot, "external-1", "bounded-task.json");
    assert(bounded.status === 0, `bounded external task is recorded: ${bounded.stderr}`);
    const afterBounded = JSON.parse(runNode(cewpCli, ["pilot", "status", "--json"], repoRoot).stdout).data;
    assert(afterBounded.complete === false, "legacy external-task evidence remains recordable without becoming a completion quota");

    for (let index = 2; index <= 10; index += 1) {
      recordInline(repoRoot, `external-${((index - 1) % 3) + 1}`, repositoryAttempt(`external-attempt-${index}`, `repo-attempt-${index}`));
    }
    for (let index = 1; index <= 3; index += 1) {
      recordInline(repoRoot, `external-${index}`, evidence(`repeat-${index}`, "repeat-user", "repeatUse", {
        runOrdinal: 2,
        withoutMaintainerAssistance: true,
      }, 10 + index));
      recordInline(repoRoot, `external-${index}`, evidence(`comparison-${index}`, "native-goal-comparison", "comparison", {
        id: `comparison-${index}`,
        equivalentTaskShape: true,
        setupOverheadMeasured: true,
        nativeUsage: "unknown",
        cewpUsage: "observed",
      }, 20 + index));
      recordInline(repoRoot, `external-${index}`, evidence(`recovery-${index}`, "recovery", "recovery", {
        id: `recovery-${index}`,
        scenario: index % 2 === 0 ? "failure-retry" : "pause-revise-resume",
        recoveredWithoutRestart: true,
        priorEvidenceRetained: true,
      }, 30 + index));
      recordInline(repoRoot, `external-${index}`, evidence(`case-study-${index}`, "public-case-study", "caseStudy", {
        id: `case-study-${index}`,
        published: true,
        receiptExcerptIncluded: true,
        limitationsIncluded: true,
        usageTruthIncluded: true,
      }, 40 + index));
    }
    recordInline(repoRoot, "external-1", evidence("benefit-1", "measurable-benefit", "benefit", {
      dimension: "evidence-quality",
      measured: true,
      setupOverheadConsidered: true,
    }, 50));
    recordInline(repoRoot, "external-1", evidence("budget-pause-1", "operational-budget-exhaustion", "pause", {
      state: "paused-budget-unverified",
      absoluteCeilingRespected: true,
      protectedReviewerAllocationRespected: true,
      passClaimed: false,
    }, 51));
    recordInline(repoRoot, "external-1", evidence("host-limit-1", "controlled-host-limit", "pause", {
      state: "paused-host-limit",
      absoluteCeilingRespected: true,
      protectedReviewerAllocationRespected: true,
      passClaimed: false,
    }, 52));
    for (let rank = 1; rank <= 5; rank += 1) {
      recordInline(repoRoot, "external-1", evidence(`onboarding-${rank}`, "onboarding-remediation", "failure", {
        rank,
        code: `onboarding-${rank}`,
        remediationStatus: rank % 2 === 0 ? "explicit-remediation" : "fixed",
      }, 52 + rank));
    }
    recordInline(repoRoot, "external-1", evidence("contribution-1", "external-contribution", "contribution", {
      kind: "substantive-issue",
      externallyAuthored: true,
    }, 58));
    recordInline(repoRoot, "external-1", evidence("calibration-1", "estimate-calibration-report", "calibration", {
      intervalCoverageReported: true,
      errorReported: true,
      taskClassBreakdown: true,
      confidencePromoted: false,
      minimumSampleMet: false,
      driftCurrent: false,
    }, 59));
    recordInline(repoRoot, "external-1", evidence("guardrail-audit-1", "guardrail-audit-pass", "audit", {
      completed: true,
      unresolvedBypasses: 0,
    }, 59));

    const broadStatus = JSON.parse(runNode(cewpCli, ["pilot", "status", "--json"], repoRoot).stdout).data;
    const expectedMet = [
      "maintainer-repository-attempt",
      "supervised-golden-path",
      "measurable-cewp-benefit",
      "recovered-control-flow",
      "guardrail-audit-with-no-unresolved-bypass",
    ];
    for (const gateId of expectedMet) {
      const gate = broadStatus.gates.find((entry) => entry.id === gateId);
      assert(gate.status === "met", `${gateId} is evaluated from qualifying structured evidence`);
    }
    assert(broadStatus.gates.find((gate) => gate.id === "full-reviewed-runs").status === "unmet", "reviewed-run gate remains open for receipt-linked evidence");
    assert(broadStatus.complete === false, "broad fixture evidence cannot bypass the reviewed-run gate");

    recordInline(repoRoot, "external-1", evidence("repeat-extra-1", "repeat-user", "repeatUse", {
      runOrdinal: 3,
      withoutMaintainerAssistance: true,
    }, 59));
    recordInline(repoRoot, "external-1", evidence("repeat-extra-2", "repeat-user", "repeatUse", {
      runOrdinal: 4,
      withoutMaintainerAssistance: true,
    }, 59));
    const afterRepeatedSameParticipant = JSON.parse(runNode(cewpCli, ["pilot", "status", "--json"], repoRoot).stdout).data;
    assert(afterRepeatedSameParticipant.complete === false, "legacy repeat-use evidence cannot bypass the reviewed-run gate");

    writeJson(path.join(repoRoot, "duplicate-attempt.json"), repositoryAttempt("duplicate-attempt-observation", "repo-attempt-1"));
    const duplicateAttempt = recordObservation(repoRoot, "external-2", "duplicate-attempt.json");
    assert(duplicateAttempt.status === 1 && duplicateAttempt.stderr.includes("evidence identity already exists"), "duplicate repository attempts fail closed across pilot records");

    const sameRepository = repositoryAttempt("same-repository-new-attempt", "new-attempt-id");
    sameRepository.attempt.repositoryId = "repo-attempt-1";
    writeJson(path.join(repoRoot, "same-repository.json"), sameRepository);
    const duplicateRepository = recordObservation(repoRoot, "external-2", "same-repository.json");
    assert(duplicateRepository.status === 1 && duplicateRepository.stderr.includes("repository-attempt:repo-attempt-1"), "one repository cannot be inflated into multiple independent repository attempts");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] structured pilot observation gates");
} catch (error) {
  console.error("[FAIL] structured pilot observation gates");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
