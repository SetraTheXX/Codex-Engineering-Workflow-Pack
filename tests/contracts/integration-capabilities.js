"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  assessCodexCompatibility,
  selectManagedBackend,
  validateCodexCapabilitySnapshot,
} = require("../../src/integration/capabilities");

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

function supportedSnapshot(overrides = {}) {
  return {
    schemaVersion: "codex-integration-capabilities/v1",
    generatedAt: "2026-07-18T10:00:00.000Z",
    codexVersion: "codex-cli 0.137.0",
    probe: {
      kind: "controlled-local",
      authenticationBoundary: "isolated CODEX_HOME without copied credentials",
      modelTurnStarted: false,
    },
    surfaces: {
      plugin: { status: "supported", schemaVersion: "plugin-manifest/v1" },
      nativeGoal: {
        status: "supported",
        access: "host-mediated",
        schemaVersion: "codex-app-server-schema/0.137.0",
        statuses: ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"],
      },
      appServer: {
        status: "experimental",
        transport: "stdio",
        separateProcessRequired: true,
        existingDesktopSessionAccess: false,
      },
      mcp: { status: "supported", transport: "stdio" },
      hooks: { status: "supported", trustRequired: true },
      hostObservation: { status: "unavailable", reason: "plugin-path-not-probed" },
    },
    managedBackendDecision: {
      selected: "codex-exec",
      appServerGraduated: false,
      reason: "No material lifecycle, usage, or recovery advantage is proven.",
    },
    ...overrides,
  };
}

function main() {
  const snapshot = validateCodexCapabilitySnapshot(supportedSnapshot());
  assert(snapshot.managedBackendDecision.selected === "codex-exec", "snapshot keeps codex-exec selected");
  assert(selectManagedBackend(snapshot) === "codex-exec", "automatic backend selection keeps codex-exec");
  assert(
    selectManagedBackend(snapshot, "app-server") === "codex-exec",
    "ungraduated App Server request falls back to codex-exec",
  );

  const compatible = assessCodexCompatibility(snapshot, {
    codexVersion: "codex-cli 0.137.0",
    nativeGoalSchemaVersion: "codex-app-server-schema/0.137.0",
  });
  assert(compatible.compatible === true, "matching versioned capability is compatible");
  assert(compatible.warnings.length === 0, "matching capability has no drift warning");

  const drifted = assessCodexCompatibility(snapshot, {
    codexVersion: "codex-cli 0.138.0",
    nativeGoalSchemaVersion: "codex-app-server-schema/0.138.0",
  });
  assert(drifted.compatible === false, "version and goal schema drift are incompatible");
  assert(drifted.fallback === "generated-goal-or-explicit-intake", "drift selects the supported fallback");
  assert(drifted.warnings.some((warning) => warning.code === "codex-version-drift"), "version drift is explicit");
  assert(drifted.warnings.some((warning) => warning.code === "native-goal-schema-drift"), "goal drift is explicit");

  const unavailable = validateCodexCapabilitySnapshot(supportedSnapshot({
    surfaces: {
      ...supportedSnapshot().surfaces,
      nativeGoal: { status: "unavailable", reason: "host-api-not-exposed" },
    },
  }));
  const unavailableAssessment = assessCodexCompatibility(unavailable, {});
  assert(unavailableAssessment.compatible === false, "unavailable native goal is not presented as attached");
  assert(unavailableAssessment.fallback === "generated-goal-or-explicit-intake", "unavailable native goal has honest fallback");

  const unsafe = supportedSnapshot();
  unsafe.surfaces.appServer.existingDesktopSessionAccess = true;
  assertThrows(
    () => validateCodexCapabilitySnapshot(unsafe),
    /must not claim access to an existing ChatGPT desktop session/,
    "private desktop session access is rejected",
  );

  const falselyObserved = supportedSnapshot();
  falselyObserved.surfaces.hostObservation = { status: "supported", source: "app-server" };
  assertThrows(
    () => validateCodexCapabilitySnapshot(falselyObserved),
    /pluginPathCapabilityTestPassed/,
    "host data cannot be plugin-observed without a plugin-path capability test",
  );

  const repoRoot = path.resolve(__dirname, "..", "..");
  const decision = fs.readFileSync(
    path.join(repoRoot, "docs", "adr", "0005-codex-integration-backend.md"),
    "utf8",
  );
  for (const required of [
    "managed`, `native`, and `audit-only`",
    "codex-exec",
    "generated-goal and explicit-intake fallback",
    "must not attach to the ChatGPT desktop app's existing internal session",
    "Local MCP",
  ]) {
    assert(decision.includes(required), `integration decision documents ${required}`);
  }

  const capabilityMatrix = fs.readFileSync(
    path.join(repoRoot, "docs", "codex-capability-matrix.md"),
    "utf8",
  );
  assert(capabilityMatrix.includes("Status: accepted Phase 11 decision"), "capability matrix is Phase 11 current");
  assert(capabilityMatrix.includes("plugin install, disable, upgrade, and uninstall"), "plugin lifecycle evidence is current");
  assert(!capabilityMatrix.includes("Phase 9 must test"), "capability matrix has no stale Phase 9 promise");

  console.log("[PASS] Codex integration capability drift and backend decision stay truthful");
}

try {
  main();
} catch (error) {
  console.error("[FAIL] Codex integration capability contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}

module.exports = { supportedSnapshot };
