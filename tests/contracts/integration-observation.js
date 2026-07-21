"use strict";

const fs = require("node:fs");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo } = require("../harness/lib/temp-repo");
const { supportedSnapshot } = require("./integration-capabilities");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const {
  normalizeHostObservation,
  readHostObservations,
  recordHostObservation,
} = require("../../src/integration/observation");
const { loadWorkflowRun } = require("../../src/workflow/state");

function assertThrows(action, expected, label) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  assert(error, `${label}: expected an error`);
  assert(expected.test(error.message), `${label}: unexpected error: ${error.message}`);
}

function baseObservation(runId, overrides = {}) {
  return {
    schemaVersion: "host-observation/v1",
    observationId: "usage-0001",
    observedAt: "2026-07-18T12:00:00.000Z",
    source: {
      path: "codex-exec",
      codexVersion: "codex-cli 0.137.0",
      schemaVersion: "codex-exec-jsonl/v1",
      authenticationBoundary: "managed-child",
    },
    scope: {
      kind: "workflow-run",
      runId,
      taskId: "implement-change",
      checkpointId: "implement-change-attempt-0001",
    },
    category: "thread-usage",
    rawCategory: "turn.completed.usage",
    availability: "observed",
    data: {
      inputTokens: 24763,
      cachedInputTokens: 24448,
      outputTokens: 122,
      reasoningOutputTokens: 0,
    },
    raw: {
      input_tokens: 24763,
      cached_input_tokens: 24448,
      output_tokens: 122,
      reasoning_output_tokens: 0,
    },
    ...overrides,
  };
}

function main() {
  const repoRoot = makeTempRepo("cewp-host-observation-");
  try {
    const approved = approveWorkflow(repoRoot, validDefinition());
    const found = loadWorkflowRun(repoRoot, approved.runId);
    const runBefore = fs.readFileSync(found.runPath, "utf8");
    const options = {
      capabilities: supportedSnapshot(),
      now: new Date("2026-07-18T12:01:00.000Z"),
      maxAgeMs: 5 * 60 * 1000,
    };

    const observed = recordHostObservation(found, baseObservation(approved.runId), options);
    assert(observed.availability === "observed", "codex-exec JSONL usage is observed");
    assert(observed.evidenceClass === "observed", "managed JSONL is observed evidence");
    assert(observed.data.cachedInputTokens === 24448, "token categories remain distinct");
    assert(observed.billingImpact === "unknown", "subscription or billing impact is not inferred");
    assert(fs.readFileSync(found.runPath, "utf8") === runBefore, "host usage never mutates workflow budget state");

    const pluginClaim = baseObservation(approved.runId, {
      observationId: "plugin-0001",
      source: {
        path: "plugin",
        codexVersion: "codex-cli 0.137.0",
        schemaVersion: "plugin-host-observation/v1",
        authenticationBoundary: "host-owned",
      },
    });
    const unavailable = normalizeHostObservation(pluginClaim, options);
    assert(unavailable.availability === "unavailable", "unprobed plugin observation is unavailable");
    assert(unavailable.evidenceClass === "unknown", "unprobed plugin data is not observed evidence");
    assert(unavailable.data === null, "unavailable plugin data is not exposed");
    assert(unavailable.raw !== null, "unavailable input keeps bounded raw semantics for diagnosis");

    const imported = normalizeHostObservation(baseObservation(approved.runId, {
      observationId: "audit-0001",
      source: {
        path: "audit-import",
        codexVersion: null,
        schemaVersion: "external-receipt/v1",
        authenticationBoundary: "external-owner",
      },
      availability: "imported",
    }), options);
    assert(imported.availability === "imported", "audit evidence remains imported");
    assert(imported.evidenceClass === "imported", "audit evidence is not relabeled observed");

    const stale = normalizeHostObservation(baseObservation(approved.runId, {
      observationId: "rate-limit-old",
      observedAt: "2026-07-18T11:00:00.000Z",
      source: {
        path: "audit-import",
        codexVersion: null,
        schemaVersion: "external-rate-limit/v1",
        authenticationBoundary: "external-owner",
      },
      scope: { kind: "account", runId: null, taskId: null, checkpointId: null },
      category: "rate-limit-window",
      rawCategory: "account.rate_limit",
      availability: "imported",
      data: { window: "primary", usedPercent: 75, resetAt: "2026-07-18T13:00:00.000Z" },
    }), options);
    assert(stale.availability === "stale", "old rate-limit data is explicitly stale");
    assert(stale.data === null, "stale limits are not presented as current data");

    const malformed = normalizeHostObservation(baseObservation(approved.runId, {
      observationId: "usage-malformed",
      data: { inputTokens: -1, outputTokens: "many" },
    }), options);
    assert(malformed.availability === "malformed", "invalid usage categories are retained as malformed");
    assert(malformed.data === null, "malformed usage is never exposed as observed totals");

    const unknown = normalizeHostObservation(baseObservation(approved.runId, {
      observationId: "usage-unknown",
      availability: "unknown",
      reason: "native-host-usage-not-exposed",
      data: null,
    }), options);
    assert(unknown.availability === "unknown", "unavailable native usage remains unknown");
    assert(unknown.data === null && unknown.evidenceClass === "unknown", "unknown usage is never zero");

    const accountActivity = normalizeHostObservation(baseObservation(approved.runId, {
      observationId: "account-activity-0001",
      source: {
        path: "audit-import",
        codexVersion: null,
        schemaVersion: "external-account-activity/v1",
        authenticationBoundary: "external-owner",
      },
      scope: { kind: "account", runId: null, taskId: null, checkpointId: null },
      category: "account-activity",
      rawCategory: "account.activity",
      availability: "imported",
      data: {
        windowStart: "2026-07-18T00:00:00.000Z",
        windowEnd: "2026-07-18T12:00:00.000Z",
        amount: 12,
        unit: "operations",
      },
    }), options);
    assert(accountActivity.scope.kind === "account", "account activity is not presented as per-run usage");
    assert(accountActivity.scope.runId === null, "account activity has no invented run attribution");

    recordHostObservation(found, pluginClaim, options);
    const ledger = readHostObservations(found);
    assert(ledger.length === 2, "observation ledger retains observed and unavailable records");
    assert(ledger[1].availability === "unavailable", "persisted plugin claim remains unavailable");
    assertThrows(
      () => recordHostObservation(found, baseObservation(approved.runId), options),
      /already exists/,
      "observation ids are immutable",
    );

    assertThrows(
      () => normalizeHostObservation(baseObservation(approved.runId, {
        observationId: "misattributed-account",
        scope: { kind: "account", runId: approved.runId, taskId: null, checkpointId: null },
        category: "account-activity",
        rawCategory: "account.activity",
      }), options),
      /account scope cannot claim workflow attribution/,
      "account activity cannot be relabeled as per-run usage",
    );

    console.log("[PASS] structured host observations preserve observed, imported, stale, and unknown truth");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  main();
} catch (error) {
  console.error("[FAIL] structured host observation contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
