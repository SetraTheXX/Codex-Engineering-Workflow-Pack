"use strict";

const packageJson = require("../../package.json");

const STABLE_COMPATIBILITY_SCHEMA_VERSION = "stable-compatibility/v1";

function numericVersion(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported package version: ${value || "missing"}.`);
  return match.slice(1).map(Number);
}

function assessDowngradeCompatibility(readerVersion, stateWrittenByVersion) {
  const reader = numericVersion(readerVersion);
  const writer = numericVersion(stateWrittenByVersion);
  const readerIsOlder = reader.some((part, index) => part !== writer[index] && part < writer[index]
    && reader.slice(0, index).every((earlier, earlierIndex) => earlier === writer[earlierIndex]));
  return {
    schemaVersion: "downgrade-compatibility/v1",
    compatible: !readerIsOlder,
    readerVersion,
    stateWrittenByVersion,
    warning: readerIsOlder ? {
      code: "package-downgrade-state-newer",
      action: "Use the newer CEWP reader or a documented export; do not rewrite canonical state.",
    } : null,
  };
}

function buildCompatibilityContract() {
  return {
    schemaVersion: STABLE_COMPATIBILITY_SCHEMA_VERSION,
    packageVersion: packageJson.version,
    release: {
      line: "1.x candidate",
      status: "blocked-pilot-evidence",
      reason: "Phase 13 requires genuine independent pilot evidence before 1.0.",
    },
    runtime: {
      node: { majors: [22, 24, 26], minimum: "22.0.0", evidence: "repository CI matrix" },
      operatingSystems: ["windows-latest", "ubuntu-latest"],
      git: { minimum: "2.39.0", testedLocally: "2.49.0.windows.1" },
      codexCli: { tested: ["0.137.0"], compatibility: "capability-probed; drift warns and falls back" },
    },
    package: {
      npm: "same version as packageVersion",
      pluginManifest: "same version as packageVersion",
      pluginInstallSurface: "Codex CLI and supported ChatGPT desktop Codex mode",
    },
    execution: {
      modes: ["supervised", "autonomous", "audit-only"],
      owners: ["managed", "native", "audit-only"],
      managedBackend: { id: "codex-exec", status: "stable-selected" },
      appServer: { status: "experimental-not-graduated", fallback: "codex-exec" },
      nativeGoal: { status: "versioned-observation-or-explicit-intake", completionAuthority: false },
    },
    hostClaims: {
      nativeCompletionIsVerification: false,
      unknownUsageBecomesZero: false,
      privateDesktopAttachmentSupported: false,
      persistentNativePanelSupported: false,
    },
    schemas: {
      workflowDefinition: "workflow-definition/v1",
      runState: "run-state/v2",
      legacySupervisedRun: "supervised-run/v1 (read-only projection and explicit migration)",
      taskResult: "task-result/v1",
      evidenceReceipt: "evidence-receipt/v1",
      event: "event/v1",
      pilotRecord: "pilot-record/v1",
      pilotObservation: "pilot-observation/v1",
      pilotStatus: "pilot-status/v1",
      pilotExport: "pilot-export/v1",
      mcpProtocol: "cewp-mcp/v1",
    },
  };
}

function runCompatibility(options = {}) {
  const contract = buildCompatibilityContract();
  if (options.json) console.log(JSON.stringify(contract, null, 2));
  else {
    console.log("CEWP stable compatibility candidate");
    console.log(`Package: ${contract.packageVersion}`);
    console.log(`1.0 eligibility: ${contract.release.status}`);
    console.log(`Managed backend: ${contract.execution.managedBackend.id}`);
    console.log(`Node: ${contract.runtime.node.majors.join(", ")}`);
  }
}

module.exports = { STABLE_COMPATIBILITY_SCHEMA_VERSION, assessDowngradeCompatibility, buildCompatibilityContract, runCompatibility };
