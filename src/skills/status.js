"use strict";

const fs = require("node:fs");
const { resolveTarget, getSkillStatus } = require("./paths");
const { MANUAL_ADAPTER, OPENCODE_ADAPTER } = require("../run/adapters/registry");
const { ADAPTER_CONFIG_ROLES } = require("../run/adapters/config");

function list(options) {
  const targetRoot = resolveTarget(options);
  const statuses = getSkillStatus(targetRoot);

  console.log(`Skills target: ${targetRoot}`);
  console.log("");

  for (const status of statuses) {
    const state = status.hasDirectory && status.hasSkillFile ? "OK" : "MISSING";
    console.log(`[${state}] ${status.skill}`);
  }
}

function formatAdapterCapabilities(capabilities) {
  const labels = [capabilities.kind];

  if (capabilities.experimental) {
    labels.push("experimental");
  }

  if (capabilities.supportsDryRun) {
    labels.push("dry-run");
  }

  if (capabilities.supportsManualHandoff) {
    labels.push("handoff");
  }

  if (capabilities.supportsResultIntake) {
    labels.push("result-intake");
  }

  labels.push(capabilities.executesExternalCommand ? "external command" : "no external command");

  if (capabilities.requiresExternalBinary) {
    labels.push("external binary");
  }

  if (capabilities.requiresAuth) {
    labels.push("auth");
  }

  if (capabilities.supportsLastMessage) {
    labels.push("last-message");
  }

  if (capabilities.executionImplemented === false) {
    labels.push("dry-run only");
  }

  return labels.join(", ");
}

function formatAdapterRequirement(requirement) {
  const state = requirement.available ? "available" : "missing";
  const required = requirement.required ? "required" : "optional";
  const command = requirement.command ? ` (${requirement.command})` : "";
  return `${requirement.type} ${requirement.name}: ${state}, ${required}${command}`;
}

function formatAdapterProbe(probe) {
  if (!probe || !probe.command) {
    return undefined;
  }

  const args = Array.isArray(probe.args) ? probe.args.join(" ") : "";
  return `${probe.command}${args ? ` ${args}` : ""}`;
}

function doctor(options) {
  const { buildDoctorFailureReport, buildDoctorReport } = require("./doctor-report");
  let report;
  try {
    report = buildDoctorReport(options);
  } catch (error) {
    if (!options.json) throw error;
    console.log(JSON.stringify(buildDoctorFailureReport(options, error), null, 2));
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "pass") process.exitCode = 1;
    return;
  }

  const targetRoot = report.target;
  const statuses = report.skills.items;
  const missing = statuses.filter((status) => !status.hasDirectory || !status.hasSkillFile);

  console.log("Codex Engineering Workflow Pack doctor");
  console.log(`Mode: ${options.mode}`);
  console.log(`Target: ${targetRoot}`);
  console.log("");

  if (!fs.existsSync(targetRoot)) {
    console.log("Status: FAIL");
    console.log("Reason: target skills directory does not exist.");
    console.log("");
    console.log("Run `cewp init` for repo install or `cewp init --mode global` for global install.");
    process.exitCode = 1;
    return;
  }

  for (const status of statuses) {
    const state = status.hasDirectory && status.hasSkillFile ? "OK" : "MISSING";
    console.log(`[${state}] ${status.skill}`);
  }

  console.log("");
  console.log("Adapter availability:");
  const adapterSnapshots = report.adapters.providers.map((provider) => ({
    adapterName: provider.id,
    availability: provider.availability,
    capabilities: provider.capabilities,
    profile: provider.providerProfile,
  }));
  for (const { adapterName, availability, capabilities } of adapterSnapshots) {
    const readinessLabel = adapterName === OPENCODE_ADAPTER
      ? `${adapterName} binary`
      : adapterName === MANUAL_ADAPTER
        ? `${adapterName} readiness`
        : adapterName;
    const readinessStatus = adapterName === MANUAL_ADAPTER ? "not-applicable" : availability.status;
    console.log(`[${availability.available ? "OK" : "WARN"}] ${readinessLabel}: ${readinessStatus} - ${availability.reason || "no details"}`);
    if (availability.command) {
      console.log(`  Binary: ${availability.command}`);
    }
    if (availability.version) {
      console.log(`  Version: ${availability.version}`);
    }
    const probe = formatAdapterProbe(availability.probe);
    if (probe) {
      console.log(`  Probe: ${probe}`);
    }
    for (const requirement of availability.requirements) {
      console.log(`  Requirement: ${formatAdapterRequirement(requirement)}`);
    }
    if (capabilities.experimental && capabilities.executesExternalCommand && capabilities.requiresAuth) {
      console.log("  Auth/model readiness: unknown - provider auth/model/config readiness is not verified by doctor.");
    }
    if (availability.remediation) {
      console.log(`  Remediation: ${availability.remediation}`);
    }
  }

  console.log("");
  console.log("Adapter capabilities:");
  for (const { adapterName, capabilities } of adapterSnapshots) {
    console.log(`  ${adapterName}: ${formatAdapterCapabilities(capabilities)}`);
  }

  console.log("");
  console.log("Provider profiles:");
  for (const { profile } of adapterSnapshots) {
    console.log(`  ${profile.id}: ${profile.mode}, ${profile.experimental ? "experimental" : "stable"}`);
    console.log(`    Command: ${profile.command || "none"}`);
    console.log(`    Model: ${profile.model || "not set"}`);
    console.log(`    Binary: ${profile.binary || "not applicable"}`);
    console.log(`    Version: ${profile.version || "unknown"}`);
    console.log(`    Binary readiness: ${profile.binaryReadiness}`);
    console.log(`    Auth/model readiness: ${profile.authReadiness}`);
    console.log(`    Features: ${profile.supportedFeatures.join(", ") || "none"}`);
    console.log("    Safety: CEWP guardrails, worker scope, reviewer PASS");
  }

  console.log("");
  console.log("Adapter config:");
  console.log(`  Source: ${report.adapters.config.source}`);
  for (const role of ADAPTER_CONFIG_ROLES) {
    const roleConfig = report.adapters.config.roles[role];
    console.log(`  ${role}: ${roleConfig.provider}${roleConfig.model ? ` (model: ${roleConfig.model})` : ""}`);
  }

  console.log("");

  if (missing.length > 0) {
    console.log("Status: FAIL");
    console.log(`Missing or incomplete skills: ${missing.map((status) => status.skill).join(", ")}`);
    console.log("Run `cewp init --force` to reinstall missing skill files.");
    process.exitCode = 1;
    return;
  }

  console.log("Status: PASS");
  console.log("All 10 skills are installed with SKILL.md files.");
  console.log("Restart or reload Codex if newly installed skills are not visible.");
}

module.exports = {
  list,
  doctor,
};
