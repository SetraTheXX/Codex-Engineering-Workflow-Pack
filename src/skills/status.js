"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget, getSkillStatus } = require("./paths");
const { getAdapter, getAdapterCapabilities, getSupportedAdapterNames } = require("../run/adapters/registry");
const { ADAPTER_CONFIG_FILE, ADAPTER_CONFIG_ROLES, loadAdapterConfig } = require("../run/adapters/config");

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

  return labels.join(", ");
}

function doctor(options) {
  const targetRoot = resolveTarget(options);
  const statuses = getSkillStatus(targetRoot);
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
  for (const adapterName of getSupportedAdapterNames()) {
    const adapter = getAdapter(adapterName, { commandName: "doctor" });
    const availability = adapter.checkAdapterAvailability
      ? adapter.checkAdapterAvailability()
      : adapter.checkCodexExecAvailability();
    console.log(`[${availability.status === "PASS" ? "OK" : "WARN"}] ${adapterName}: ${availability.reason}`);
  }

  console.log("");
  console.log("Adapter capabilities:");
  for (const adapterName of getSupportedAdapterNames()) {
    console.log(`  ${adapterName}: ${formatAdapterCapabilities(getAdapterCapabilities(adapterName, { commandName: "doctor" }))}`);
  }

  const adapterConfig = loadAdapterConfig(process.cwd());
  const adapterConfigSource = fs.existsSync(path.join(process.cwd(), ADAPTER_CONFIG_FILE)) ? ADAPTER_CONFIG_FILE : "default";
  console.log("");
  console.log("Adapter config:");
  console.log(`  Source: ${adapterConfigSource}`);
  for (const role of ADAPTER_CONFIG_ROLES) {
    console.log(`  ${role}: ${adapterConfig[role].provider}`);
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
