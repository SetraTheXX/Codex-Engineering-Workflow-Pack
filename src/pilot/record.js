"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getGitHeadCommit } = require("../lib/git");
const { writeJsonAtomic } = require("../workflow/state");

const PILOT_RECORD_SCHEMA_VERSION = "pilot-record/v1";
const PARTICIPANT_CLASSIFICATIONS = new Set([
  "maintainer-dogfood",
  "independent-external",
]);
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validatePilotId(value) {
  const pilotId = String(value || "").trim();
  if (!SAFE_ID.test(pilotId)) {
    throw new Error("--pilot-id requires 1-64 lowercase letters, numbers, or hyphens.");
  }
  return pilotId;
}

function validateParticipantId(value) {
  const participantId = String(value || "").trim();
  if (!SAFE_ID.test(participantId)) {
    throw new Error("--participant-id requires a privacy-safe lowercase id.");
  }
  return participantId;
}

function validateParticipantClassification(value) {
  const classification = String(value || "").trim();
  if (!PARTICIPANT_CLASSIFICATIONS.has(classification)) {
    throw new Error("--participant requires maintainer-dogfood or independent-external.");
  }
  return classification;
}

function createPilotRecord(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const pilotId = validatePilotId(options.pilotId);
  const participantId = validateParticipantId(options.participantId);
  const classification = validateParticipantClassification(options.participant);
  const recordPath = path.join(repoRoot, ".cewp", "pilots", pilotId, "record.json");
  if (fs.existsSync(recordPath)) {
    throw new Error(`Pilot record already exists: ${pilotId}.`);
  }
  const timestamp = (options.now || new Date()).toISOString();
  const record = {
    schemaVersion: PILOT_RECORD_SCHEMA_VERSION,
    pilotId,
    participant: {
      classification,
      id: participantId,
      independentEvidenceEligible: classification === "independent-external",
    },
    repository: {
      gitBaseCommit: getGitHeadCommit(repoRoot),
      pathRecorded: false,
    },
    observations: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  writeJsonAtomic(recordPath, record);
  return record;
}

module.exports = {
  PARTICIPANT_CLASSIFICATIONS,
  PILOT_RECORD_SCHEMA_VERSION,
  createPilotRecord,
  validateParticipantClassification,
  validateParticipantId,
  validatePilotId,
};
