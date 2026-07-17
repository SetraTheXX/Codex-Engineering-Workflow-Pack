"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const packageJson = require("../../package.json");
const { assert } = require("../harness/lib/assertions");
const { runNode } = require("../harness/lib/temp-repo");

const repoRoot = path.join(__dirname, "..", "..");
const cewpCli = path.join(repoRoot, "bin", "cewp.js");

function parseReport(result, label, expectedStatus = 0) {
  assert(result.status === expectedStatus, `${label} exit status`);
  assert(result.stdout.trim().startsWith("{"), `${label} returns JSON only`);
  assert(!result.stdout.includes("Codex Engineering Workflow Pack doctor"), `${label} does not mix human text into JSON`);
  return JSON.parse(result.stdout);
}

function provider(report, id) {
  return report.adapters.providers.find((entry) => entry.id === id);
}

function runDoctorJsonContract() {
  const report = parseReport(runNode(cewpCli, ["doctor", "--json"], repoRoot), "doctor JSON");
  assert(report.schemaVersion === "doctor-report/v1-beta", "doctor report is versioned");
  assert(report.status === "pass", "installed optional components do not make doctor fatal");
  assert(report.runtime.package.version === packageJson.version, "doctor reports the running package version");
  assert(report.plugin.package.status === "available", "packaged plugin manifest is detected");
  assert(report.plugin.hostInstallation.status === "unknown", "packaged plugin does not imply host installation");
  assert(report.execution.owner === "managed" && report.execution.backend === "codex-exec", "doctor reports exactly one selected owner/backend pair");
  assert(report.execution.adapter === "codex-exec", "doctor reports the selected adapter separately");
  assert(report.assuranceDefault.profile === "standard", "doctor reports standard assurance default");
  assert(report.assuranceDefault.maxConcurrentWorkers.value === 1, "doctor reports the single-worker default");
  assert(report.assuranceDefault.maxRepairsPerCheckpoint.value === 2, "doctor reports the bounded repair default");

  const ids = report.adapters.providers.map((entry) => entry.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(["codex-exec", "manual", "opencode"]), "doctor JSON exposes only implemented providers");
  const manual = provider(report, "manual");
  assert(manual.readiness.binary.status === "not-applicable", "manual binary readiness is not applicable");
  assert(manual.readiness.authentication.status === "not-applicable", "manual auth readiness is not applicable");
  assert(manual.readiness.model.status === "not-applicable", "manual model readiness is not applicable");
  const openCode = provider(report, "opencode");
  assert(["installed", "missing"].includes(openCode.readiness.binary.status), "optional OpenCode binary may be installed or missing");
  assert(openCode.readiness.authentication.status === "unknown", "OpenCode auth remains unknown");
  assert(openCode.readiness.model.status === "unknown", "OpenCode model readiness remains unknown");
  assert(openCode.experimental === true, "OpenCode remains experimental");

  assert(report.capabilities.nativeGoal.installedPluginAccess.status === "unavailable", "plugin does not claim native goal attachment");
  assert(report.capabilities.nativeGoal.managedAppServer.status === "experimental-not-selected", "App Server remains a separate unselected backend");
  assert(report.capabilities.warning.coreEnforcement.status === "supported", "Core enforcement is independent of optional warning UI");
  assert(report.capabilities.warning.coreEnforcement.dependsOnPresentation === false, "warning failure cannot reopen Core gates");
  assert(report.capabilities.warning.appsSdk.status === "unknown", "Apps SDK readiness is not inferred");
  assert(report.capabilities.hostUsage.perRunTokens.status === "unknown", "host per-run usage remains unknown");
  assert(report.capabilities.hostUsage.rateLimits.status === "unknown", "host limits remain unknown without an observed path");
  assert(Array.isArray(report.remediations), "doctor provides structured remediations");

  const modelReport = parseReport(runNode(cewpCli, ["doctor", "--json"], repoRoot, {
    env: {
      ...process.env,
      CEWP_OPENCODE_COMMAND: process.execPath,
      CEWP_OPENCODE_MODEL: "provider/doctor-contract-model",
    },
  }), "doctor JSON with OpenCode override");
  const modelOpenCode = provider(modelReport, "opencode");
  assert(modelOpenCode.readiness.binary.status === "installed", "fake OpenCode command makes only binary readiness installed");
  assert(modelOpenCode.configuredModel === "provider/doctor-contract-model", "doctor reports the configured model value");
  assert(modelOpenCode.readiness.authentication.status === "unknown", "binary availability cannot imply OpenCode auth");
  assert(modelOpenCode.readiness.model.status === "unknown", "model override cannot imply model readiness");

  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-doctor-json-missing-"));
  try {
    const missingTarget = path.join(missingRoot, "does-not-exist");
    const failed = parseReport(runNode(cewpCli, [
      "doctor", "--json", "--target", missingTarget,
    ], repoRoot), "doctor JSON setup failure", 1);
    assert(failed.status === "fail", "setup failure is represented in the report");
    assert(failed.error.code === "doctor-setup-failed", "setup failure has a stable code");
    assert(failed.remediations.length > 0 && failed.remediations[0].message, "setup failure is actionable");
  } finally {
    fs.rmSync(missingRoot, { recursive: true, force: true });
  }
}

try {
  runDoctorJsonContract();
  console.log("[PASS] doctor JSON keeps readiness and host capabilities truthful");
} catch (error) {
  console.error("[FAIL] doctor JSON contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
