"use strict";

const fs = require("node:fs");
const { resolveTarget, getSkillStatus } = require("./paths");
const { checkCodexExecAvailability } = require("../run/adapters/codex-exec");

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

  const adapterAvailability = checkCodexExecAvailability();
  console.log("");
  console.log("Adapter availability:");
  console.log(`[${adapterAvailability.status === "PASS" ? "OK" : "WARN"}] codex-exec: ${adapterAvailability.reason}`);

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
