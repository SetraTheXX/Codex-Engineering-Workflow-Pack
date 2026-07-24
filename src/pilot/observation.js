"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readRepoJson } = require("../workflow/source");
const { writeJsonAtomic } = require("../workflow/state");
const { PILOT_RECORD_SCHEMA_VERSION, validatePilotId } = require("./record");

const PILOT_OBSERVATION_SCHEMA_VERSION = "pilot-observation/v1";
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OBSERVATION_TYPES = new Set([
  "repository-attempt",
  "golden-path-complete",
  "bounded-external-task",
  "repeat-user",
  "native-goal-comparison",
  "measurable-benefit",
  "recovery",
  "operational-budget-exhaustion",
  "controlled-host-limit",
  "onboarding-remediation",
  "external-contribution",
  "public-case-study",
  "estimate-calibration-report",
  "guardrail-audit-pass",
]);
const ATTEMPT_ENUMS = Object.freeze({
  sizeBucket: new Set(["small", "medium", "large", "unknown"]),
  operatingSystem: new Set(["windows", "linux", "macos", "other"]),
  inputKind: new Set(["direct-goal", "issue", "prd", "plan", "progress"]),
  riskLevel: new Set(["low", "medium", "high"]),
  mode: new Set(["supervised", "autonomous", "audit-only"]),
});

function requireSafeId(value, label) {
  const normalized = String(value || "").trim();
  if (!SAFE_ID.test(normalized)) throw new Error(`${label} requires a privacy-safe lowercase id.`);
  return normalized;
}

function requireLabel(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.+#-]{0,31}$/.test(normalized)) {
    throw new Error(`${label} requires a bounded privacy-safe label.`);
  }
  return normalized;
}

function requireEnum(value, name) {
  if (!ATTEMPT_ENUMS[name].has(value)) {
    throw new Error(`pilot observation attempt.${name} is unsupported.`);
  }
  return value;
}

function normalizeObservedAt(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("pilot observation observedAt requires an ISO-8601 timestamp.");
  }
  return new Date(value).toISOString();
}

function validateRepositoryAttempt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("repository-attempt observation requires attempt metadata.");
  }
  return {
    id: requireSafeId(value.id, "pilot observation attempt.id"),
    language: requireLabel(value.language, "pilot observation attempt.language"),
    sizeBucket: requireEnum(value.sizeBucket, "sizeBucket"),
    operatingSystem: requireEnum(value.operatingSystem, "operatingSystem"),
    testStack: requireLabel(value.testStack, "pilot observation attempt.testStack"),
    inputKind: requireEnum(value.inputKind, "inputKind"),
    riskLevel: requireEnum(value.riskLevel, "riskLevel"),
    mode: requireEnum(value.mode, "mode"),
  };
}

function validateGoldenPath(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("golden-path-complete observation requires completion metadata.");
  }
  if (value.supervised !== true || value.completed !== true || value.participantConfirmed !== true) {
    throw new Error("golden-path-complete requires supervised, completed, and participantConfirmed to be true.");
  }
  if (!Number.isFinite(value.firstApprovalMinutes) || value.firstApprovalMinutes < 0 || value.firstApprovalMinutes > 300) {
    throw new Error("golden-path-complete requires bounded firstApprovalMinutes.");
  }
  return {
    supervised: true,
    completed: true,
    participantConfirmed: true,
    firstApprovalMinutes: value.firstApprovalMinutes,
  };
}

function validateBoundedExternalTask(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("bounded-external-task observation requires task metadata.");
  }
  if (value.bounded !== true || value.realRepository !== true || value.acceptanceDefinedBeforeExecution !== true) {
    throw new Error("bounded-external-task requires bounded, realRepository, and acceptanceDefinedBeforeExecution to be true.");
  }
  return {
    bounded: true,
    realRepository: true,
    acceptanceDefinedBeforeExecution: true,
  };
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} requires structured metadata.`);
  }
  return value;
}

function requireTrue(value, label) {
  if (value !== true) throw new Error(`${label} must be true.`);
  return true;
}

function requireFalse(value, label) {
  if (value !== false) throw new Error(`${label} must be false.`);
  return false;
}

function validateRepeatUse(value) {
  const input = requireObject(value, "repeat-user");
  if (!Number.isInteger(input.runOrdinal) || input.runOrdinal < 2) {
    throw new Error("repeat-user runOrdinal must be at least 2.");
  }
  return {
    runOrdinal: input.runOrdinal,
    withoutMaintainerAssistance: requireTrue(input.withoutMaintainerAssistance, "repeat-user withoutMaintainerAssistance"),
  };
}

function validateComparison(value) {
  const input = requireObject(value, "native-goal-comparison");
  const truthLabels = new Set(["observed", "unknown"]);
  if (!truthLabels.has(input.nativeUsage) || !truthLabels.has(input.cewpUsage)) {
    throw new Error("native-goal-comparison usage labels must be observed or unknown.");
  }
  return {
    id: requireSafeId(input.id, "native-goal-comparison id"),
    equivalentTaskShape: requireTrue(input.equivalentTaskShape, "native-goal-comparison equivalentTaskShape"),
    setupOverheadMeasured: requireTrue(input.setupOverheadMeasured, "native-goal-comparison setupOverheadMeasured"),
    nativeUsage: input.nativeUsage,
    cewpUsage: input.cewpUsage,
  };
}

function validateBenefit(value) {
  const input = requireObject(value, "measurable-benefit");
  const dimensions = new Set(["recovery", "policy-enforcement", "independent-findings", "evidence-quality"]);
  if (!dimensions.has(input.dimension)) throw new Error("measurable-benefit dimension is unsupported.");
  return {
    dimension: input.dimension,
    measured: requireTrue(input.measured, "measurable-benefit measured"),
    setupOverheadConsidered: requireTrue(input.setupOverheadConsidered, "measurable-benefit setupOverheadConsidered"),
  };
}

function validateRecovery(value) {
  const input = requireObject(value, "recovery");
  if (!["pause-revise-resume", "failure-retry"].includes(input.scenario)) {
    throw new Error("recovery scenario is unsupported.");
  }
  return {
    id: requireSafeId(input.id, "recovery id"),
    scenario: input.scenario,
    recoveredWithoutRestart: requireTrue(input.recoveredWithoutRestart, "recovery recoveredWithoutRestart"),
    priorEvidenceRetained: requireTrue(input.priorEvidenceRetained, "recovery priorEvidenceRetained"),
  };
}

function validatePause(value, expectedType) {
  const input = requireObject(value, expectedType);
  const allowedStates = expectedType === "controlled-host-limit"
    ? ["paused-host-limit"]
    : ["paused-budget-safe", "paused-budget-unverified"];
  if (!allowedStates.includes(input.state)) throw new Error(`${expectedType} pause state is unsupported.`);
  return {
    state: input.state,
    absoluteCeilingRespected: requireTrue(input.absoluteCeilingRespected, `${expectedType} absoluteCeilingRespected`),
    protectedReviewerAllocationRespected: requireTrue(input.protectedReviewerAllocationRespected, `${expectedType} protectedReviewerAllocationRespected`),
    passClaimed: requireFalse(input.passClaimed, `${expectedType} passClaimed`),
  };
}

function validateOnboardingFailure(value) {
  const input = requireObject(value, "onboarding-remediation");
  if (!Number.isInteger(input.rank) || input.rank < 1 || input.rank > 5) {
    throw new Error("onboarding-remediation rank must be from 1 to 5.");
  }
  if (!["fixed", "explicit-remediation"].includes(input.remediationStatus)) {
    throw new Error("onboarding-remediation status is unsupported.");
  }
  return {
    rank: input.rank,
    code: requireSafeId(input.code, "onboarding-remediation code"),
    remediationStatus: input.remediationStatus,
  };
}

function validateContribution(value) {
  const input = requireObject(value, "external-contribution");
  if (!["external-contribution", "substantive-issue"].includes(input.kind)) {
    throw new Error("external-contribution kind is unsupported.");
  }
  return {
    kind: input.kind,
    externallyAuthored: requireTrue(input.externallyAuthored, "external-contribution externallyAuthored"),
  };
}

function validateCaseStudy(value) {
  const input = requireObject(value, "public-case-study");
  return {
    id: requireSafeId(input.id, "public-case-study id"),
    published: requireTrue(input.published, "public-case-study published"),
    receiptExcerptIncluded: requireTrue(input.receiptExcerptIncluded, "public-case-study receiptExcerptIncluded"),
    limitationsIncluded: requireTrue(input.limitationsIncluded, "public-case-study limitationsIncluded"),
    usageTruthIncluded: requireTrue(input.usageTruthIncluded, "public-case-study usageTruthIncluded"),
  };
}

function validateCalibration(value) {
  const input = requireObject(value, "estimate-calibration-report");
  const confidencePromoted = input.confidencePromoted === true;
  const minimumSampleMet = input.minimumSampleMet === true;
  const driftCurrent = input.driftCurrent === true;
  if (confidencePromoted && (!minimumSampleMet || !driftCurrent)) {
    throw new Error("estimate confidence cannot be promoted without minimum samples and current drift evidence.");
  }
  return {
    intervalCoverageReported: requireTrue(input.intervalCoverageReported, "estimate-calibration intervalCoverageReported"),
    errorReported: requireTrue(input.errorReported, "estimate-calibration errorReported"),
    taskClassBreakdown: requireTrue(input.taskClassBreakdown, "estimate-calibration taskClassBreakdown"),
    confidencePromoted,
    minimumSampleMet,
    driftCurrent,
  };
}

function validateGuardrailAudit(value) {
  const input = requireObject(value, "guardrail-audit-pass");
  if (input.unresolvedBypasses !== 0) {
    throw new Error("guardrail-audit-pass requires zero unresolved bypasses.");
  }
  return {
    completed: requireTrue(input.completed, "guardrail-audit completed"),
    unresolvedBypasses: 0,
  };
}

function normalizeObservationData(value) {
  switch (value.type) {
    case "repository-attempt": return { attempt: validateRepositoryAttempt(value.attempt) };
    case "golden-path-complete": return { completion: validateGoldenPath(value.completion) };
    case "bounded-external-task": return { task: validateBoundedExternalTask(value.task) };
    case "repeat-user": return { repeatUse: validateRepeatUse(value.repeatUse) };
    case "native-goal-comparison": return { comparison: validateComparison(value.comparison) };
    case "measurable-benefit": return { benefit: validateBenefit(value.benefit) };
    case "recovery": return { recovery: validateRecovery(value.recovery) };
    case "operational-budget-exhaustion": return { pause: validatePause(value.pause, value.type) };
    case "controlled-host-limit": return { pause: validatePause(value.pause, value.type) };
    case "onboarding-remediation": return { failure: validateOnboardingFailure(value.failure) };
    case "external-contribution": return { contribution: validateContribution(value.contribution) };
    case "public-case-study": return { caseStudy: validateCaseStudy(value.caseStudy) };
    case "estimate-calibration-report": return { calibration: validateCalibration(value.calibration) };
    case "guardrail-audit-pass": return { audit: validateGuardrailAudit(value.audit) };
    default: throw new Error(`Unsupported pilot observation type: ${value.type || "missing"}.`);
  }
}

function validatePilotObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pilot observation must be a JSON object.");
  }
  if (value.schemaVersion !== PILOT_OBSERVATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported pilot observation schema: ${value.schemaVersion || "missing"}.`);
  }
  if (!OBSERVATION_TYPES.has(value.type)) {
    throw new Error(`Unsupported pilot observation type: ${value.type || "missing"}.`);
  }
  return {
    schemaVersion: PILOT_OBSERVATION_SCHEMA_VERSION,
    id: requireSafeId(value.observationId, "pilot observation observationId"),
    type: value.type,
    observedAt: normalizeObservedAt(value.observedAt),
    data: normalizeObservationData(value),
  };
}

function loadPilotRecord(repoRoot, pilotId) {
  const id = validatePilotId(pilotId);
  const recordPath = path.join(path.resolve(repoRoot), ".cewp", "pilots", id, "record.json");
  if (!fs.existsSync(recordPath)) throw new Error(`Pilot record not found: ${id}.`);
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  if (record.schemaVersion !== PILOT_RECORD_SCHEMA_VERSION || record.pilotId !== id) {
    throw new Error(`Pilot record ${id} is malformed or incompatible.`);
  }
  return { record, recordPath };
}

function observationEvidenceIdentity(observation) {
  if (observation.type === "repository-attempt") return `repository-attempt:${observation.data.attempt.id}`;
  if (observation.type === "native-goal-comparison") return `native-goal-comparison:${observation.data.comparison.id}`;
  if (observation.type === "recovery") return `recovery:${observation.data.recovery.id}`;
  if (observation.type === "public-case-study") return `public-case-study:${observation.data.caseStudy.id}`;
  if (observation.type === "onboarding-remediation") return `onboarding-remediation:${observation.data.failure.code}`;
  return `${observation.type}:${observation.id}`;
}

function existingObservationIdentities(repoRoot) {
  const pilotsRoot = path.join(path.resolve(repoRoot), ".cewp", "pilots");
  const identities = new Set();
  if (!fs.existsSync(pilotsRoot)) return identities;
  for (const entry of fs.readdirSync(pilotsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const recordPath = path.join(pilotsRoot, entry.name, "record.json");
    if (!fs.existsSync(recordPath)) continue;
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    for (const observation of record.observations || []) {
      identities.add(`observation:${observation.id}`);
      identities.add(`evidence:${observationEvidenceIdentity(observation)}`);
    }
  }
  return identities;
}

function recordPilotObservation(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const source = readRepoJson(repoRoot, options.fromFile, "pilot observation --from");
  const observation = validatePilotObservation(source.value);
  const found = loadPilotRecord(repoRoot, options.pilotId);
  const identities = existingObservationIdentities(repoRoot);
  const duplicateIdentity = identities.has(`observation:${observation.id}`)
    ? `observation:${observation.id}`
    : identities.has(`evidence:${observationEvidenceIdentity(observation)}`)
      ? observationEvidenceIdentity(observation)
      : null;
  if (duplicateIdentity) {
    throw new Error(`Pilot evidence identity already exists: ${duplicateIdentity}.`);
  }
  const eligible = found.record.participant.classification === "independent-external";
  const stored = {
    ...observation,
    recordedAt: (options.now || new Date()).toISOString(),
    source: { sha256: source.sha256, pathRecorded: false },
    qualification: {
      eligible,
      classification: eligible ? "independent-evidence" : "maintainer-dogfood",
      reason: eligible
        ? "validated structured observation from an independent-external pilot record"
        : "maintainer dogfood never counts as independent Phase 13 evidence",
    },
  };
  const record = {
    ...found.record,
    observations: [...(found.record.observations || []), stored],
    updatedAt: stored.recordedAt,
  };
  writeJsonAtomic(found.recordPath, record);
  return { record, observation: stored };
}

module.exports = {
  OBSERVATION_TYPES,
  PILOT_OBSERVATION_SCHEMA_VERSION,
  loadPilotRecord,
  observationEvidenceIdentity,
  recordPilotObservation,
  validatePilotObservation,
};
