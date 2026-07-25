"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PILOT_RECORD_SCHEMA_VERSION } = require("./record");

const PILOT_STATUS_SCHEMA_VERSION = "pilot-status/v1";
const COUNT_GATES = Object.freeze([
  { id: "independent-repository-attempts", threshold: 10, observationType: "repository-attempt" },
  { id: "independent-external-participants", threshold: 3, source: "participants" },
  { id: "real-bounded-external-repository-task", threshold: 1, observationType: "bounded-external-task" },
  { id: "full-reviewed-runs", threshold: 5, observationType: "full-reviewed-run" },
  { id: "repeat-users-without-maintainer-assistance", threshold: 3, observationType: "repeat-user" },
  { id: "comparable-native-goal-runs", threshold: 3, observationType: "native-goal-comparison" },
  { id: "measurable-cewp-benefit", threshold: 1, observationType: "measurable-benefit" },
  { id: "recovered-pause-or-failure-scenarios", threshold: 3, observationType: "recovery" },
  { id: "operational-budget-exhaustion", threshold: 1, observationType: "operational-budget-exhaustion" },
  { id: "controlled-host-limit", threshold: 1, observationType: "controlled-host-limit" },
  { id: "top-onboarding-failures-remediated", threshold: 5, observationType: "onboarding-remediation" },
  { id: "external-contribution-or-substantive-issue", threshold: 1, observationType: "external-contribution" },
  { id: "public-case-studies", threshold: 3, observationType: "public-case-study" },
  { id: "usage-estimate-calibration-reported", threshold: 1, observationType: "estimate-calibration-report" },
  { id: "guardrail-audit-with-no-unresolved-bypass", threshold: 1, observationType: "guardrail-audit-pass" },
]);

function inspectPilotRecords(repoRoot) {
  const pilotsRoot = path.join(path.resolve(repoRoot), ".cewp", "pilots");
  if (!fs.existsSync(pilotsRoot)) return { valid: [], invalid: [] };
  const result = { valid: [], invalid: [] };
  for (const entry of fs.readdirSync(pilotsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(pilotsRoot, entry.name, "record.json");
    if (!fs.existsSync(filePath)) {
      result.invalid.push({ pilotId: entry.name, reason: "record-missing" });
      continue;
    }
    try {
      const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (record.schemaVersion !== PILOT_RECORD_SCHEMA_VERSION || record.pilotId !== entry.name) {
        result.invalid.push({ pilotId: entry.name, reason: "schema-or-identity-incompatible" });
        continue;
      }
      result.valid.push(record);
    } catch {
      result.invalid.push({ pilotId: entry.name, reason: "json-malformed" });
    }
  }
  return result;
}

function loadPilotRecords(repoRoot) {
  const inspected = inspectPilotRecords(repoRoot);
  if (inspected.invalid.length > 0) {
    throw new Error(`Pilot records contain ${inspected.invalid.length} invalid local record(s); inspect pilot status before export.`);
  }
  return inspected.valid;
}

function derivePilotStatus(repoRoot) {
  const inspected = inspectPilotRecords(repoRoot);
  const records = inspected.valid;
  const externalRecords = records.filter((record) => record.participant.classification === "independent-external");
  const externalParticipantIds = new Set(externalRecords
    .filter((record) => (record.observations || []).some((observation) => (
      observation.type === "golden-path-complete" && observation.qualification?.eligible === true
    )))
    .map((record) => record.participant.id));
  const evidenceByType = new Map();
  for (const record of externalRecords) {
    for (const observation of record.observations || []) {
      if (!observation || observation.qualification?.eligible !== true || typeof observation.type !== "string") continue;
      if (!evidenceByType.has(observation.type)) evidenceByType.set(observation.type, []);
      evidenceByType.get(observation.type).push({
        participantId: record.participant.id,
        pilotId: record.pilotId,
        observation,
      });
    }
  }
  const gates = COUNT_GATES.map((definition) => {
    let qualifyingEvidence;
    if (definition.source === "participants") {
      qualifyingEvidence = [...externalParticipantIds].sort();
    } else {
      const evidence = evidenceByType.get(definition.observationType) || [];
      const unique = new Map();
      for (const item of evidence) {
        const identity = definition.observationType === "repository-attempt"
          ? item.observation.data.attempt.repositoryId
          : definition.observationType === "repeat-user"
            ? item.participantId
            : `${item.pilotId}:${item.observation.id || item.observation.type}`;
        if (!unique.has(identity)) unique.set(identity, identity);
      }
      qualifyingEvidence = [...unique.values()].sort();
    }
    const observed = qualifyingEvidence.length;
    return {
      id: definition.id,
      threshold: definition.threshold,
      observed,
      remaining: Math.max(0, definition.threshold - observed),
      status: observed >= definition.threshold ? "met" : "unmet",
      qualifyingEvidence,
    };
  });
  return {
    schemaVersion: PILOT_STATUS_SCHEMA_VERSION,
    complete: inspected.invalid.length === 0 && gates.every((gate) => gate.status === "met"),
    records: { total: records.length + inspected.invalid.length, valid: records.length, invalid: inspected.invalid.length },
    participants: {
      maintainerDogfood: records.filter((record) => record.participant.classification === "maintainer-dogfood").length,
      independentExternal: externalParticipantIds.size,
    },
    gates,
    exclusions: records
      .filter((record) => record.participant.classification !== "independent-external")
      .map((record) => ({
        pilotId: record.pilotId,
        classification: record.participant.classification,
        reason: "maintainer dogfood never counts as independent Phase 13 evidence",
      })),
    warnings: [
      ...inspected.invalid.map((record) => ({ code: "pilot-record-invalid", pilotId: record.pilotId, reason: record.reason })),
      ...gates
        .filter((gate) => gate.status === "unmet")
        .map((gate) => ({ code: "pilot-gate-unmet", gate: gate.id, remaining: gate.remaining })),
    ],
  };
}

module.exports = {
  COUNT_GATES,
  PILOT_STATUS_SCHEMA_VERSION,
  derivePilotStatus,
  inspectPilotRecords,
  loadPilotRecords,
};
