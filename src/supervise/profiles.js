"use strict";

const ASSURANCE_PROFILES = Object.freeze(["prototype", "standard", "critical"]);
const TEST_AUTHORING_POLICIES = Object.freeze(["auto", "ask", "never"]);

const PROFILE_DEFAULTS = Object.freeze({
  prototype: {
    modelOperations: 6,
    maxRepairsPerCheckpoint: 1,
    maxElapsedMinutes: 30,
    maxTargetedVerificationRuns: 3,
    maxFullVerificationRuns: 1,
    allocations: {
      implementation: 3,
      repair: 1,
      reviewer: 1,
      finalization: 1,
    },
  },
  standard: {
    modelOperations: 10,
    maxRepairsPerCheckpoint: 2,
    maxElapsedMinutes: 45,
    maxTargetedVerificationRuns: 4,
    maxFullVerificationRuns: 1,
    allocations: {
      implementation: 6,
      repair: 2,
      reviewer: 1,
      finalization: 1,
    },
  },
  critical: {
    modelOperations: 15,
    maxRepairsPerCheckpoint: 2,
    maxElapsedMinutes: 90,
    maxTargetedVerificationRuns: 8,
    maxFullVerificationRuns: 2,
    allocations: {
      implementation: 8,
      repair: 4,
      reviewer: 2,
      finalization: 1,
    },
  },
});

function budgeted(value) {
  return { label: "budgeted", value };
}

function validateProfile(profile) {
  if (!ASSURANCE_PROFILES.includes(profile)) {
    throw new Error(`Unsupported assurance profile: ${profile}. Expected ${ASSURANCE_PROFILES.join(", ")}.`);
  }
}

function validateTestAuthoring(policy) {
  if (!TEST_AUTHORING_POLICIES.includes(policy)) {
    throw new Error(`Unsupported test-authoring policy: ${policy}. Expected ${TEST_AUTHORING_POLICIES.join(", ")}.`);
  }
}

function makeBudgetEnvelope(profile) {
  validateProfile(profile);
  const defaults = PROFILE_DEFAULTS[profile];
  const allocationTotal = Object.values(defaults.allocations).reduce((total, value) => total + value, 0);

  if (allocationTotal !== defaults.modelOperations) {
    throw new Error(`Invalid ${profile} budget: allocations must equal the absolute ceiling.`);
  }

  return {
    schemaVersion: "budget-envelope/v1-beta",
    modelOperations: budgeted(defaults.modelOperations),
    allocations: {
      implementation: budgeted(defaults.allocations.implementation),
      repair: budgeted(defaults.allocations.repair),
      reviewer: budgeted(defaults.allocations.reviewer),
      finalization: budgeted(defaults.allocations.finalization),
    },
    protectedAllocations: ["reviewer", "finalization"],
    maxRepairsPerCheckpoint: budgeted(defaults.maxRepairsPerCheckpoint),
    maxElapsedMinutes: budgeted(defaults.maxElapsedMinutes),
    maxConcurrentWorkers: budgeted(1),
    maxCapturedOutputBytes: budgeted(1024 * 1024),
    maxTargetedVerificationRuns: budgeted(defaults.maxTargetedVerificationRuns),
    maxFullVerificationRuns: budgeted(defaults.maxFullVerificationRuns),
    thresholds: {
      earlyWarningPercent: budgeted(70),
      reservePercent: budgeted(90),
      absoluteCeilingPercent: budgeted(100),
    },
    consumed: {
      modelOperations: 0,
      allocations: {
        implementation: 0,
        repair: 0,
        reviewer: 0,
        finalization: 0,
      },
      targetedVerificationRuns: 0,
      fullVerificationRuns: 0,
      capturedOutputBytes: 0,
    },
    thresholdEvents: [],
    revisions: [],
    hostLimit: null,
  };
}

function makeUsagePreview() {
  return {
    managedOperations: {
      label: "observed",
      value: 0,
      source: "cewp-core",
    },
    managedTokens: {
      label: "unknown",
      value: null,
      reason: "No managed Codex turn has completed.",
    },
    hostInternal: {
      label: "unknown",
      value: null,
      reason: "The selected managed path does not expose host-internal usage.",
    },
    estimate: {
      label: "unknown",
      range: null,
      confidence: "unavailable",
      sampleCount: 0,
      estimatorVersion: "local-history/v1",
      reason: "At least five comparable local runs are required for a numeric estimate.",
    },
    currency: {
      label: "unknown",
      value: null,
      reason: "No supported billing mapping is available.",
    },
  };
}

function assertVerificationScheduleFits(budget, targetedCount, fullCount) {
  const targetedRuns = targetedCount * (2 + budget.maxRepairsPerCheckpoint.value);
  if (targetedRuns > budget.maxTargetedVerificationRuns.value) {
    throw new Error(
      `Targeted verification repair envelope requires ${targetedRuns} runs, but the assurance budget allows ${budget.maxTargetedVerificationRuns.value}.`,
    );
  }
  if (fullCount > budget.maxFullVerificationRuns.value) {
    throw new Error("Approved full verification commands exceed the assurance profile budget.");
  }
}

module.exports = {
  ASSURANCE_PROFILES,
  TEST_AUTHORING_POLICIES,
  assertVerificationScheduleFits,
  makeBudgetEnvelope,
  makeUsagePreview,
  validateProfile,
  validateTestAuthoring,
};
