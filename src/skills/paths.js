"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILLS = [
  "setup-codex-engineering-workflow",
  "diagnose",
  "tdd",
  "grill-with-docs",
  "to-prd",
  "to-issues",
  "handoff",
  "zoom-out",
  "prototype",
  "improve-codebase-architecture",
];

function resolveTarget(options, { announceDefault = false } = {}) {
  if (options.mode !== "repo" && options.mode !== "global") {
    throw new Error("--mode must be repo or global.");
  }

  if (options.mode === "global" && options.target) {
    throw new Error("--target is only supported with --mode repo.");
  }

  const repoTarget = path.resolve(options.target || process.cwd());

  if (options.mode === "repo" && !options.targetProvided && announceDefault) {
    console.log(`No --target provided. Installing into current directory: ${repoTarget}`);
  }

  if (options.mode === "repo" && !fs.existsSync(repoTarget)) {
    throw new Error(`Target repo path does not exist: ${repoTarget}`);
  }

  return options.mode === "global"
    ? path.join(os.homedir(), ".agents", "skills")
    : path.join(repoTarget, ".agents", "skills");
}

function getSkillStatus(targetRoot) {
  return SKILLS.map((skill) => {
    const skillRoot = path.join(targetRoot, skill);
    const skillFile = path.join(skillRoot, "SKILL.md");
    return {
      skill,
      hasDirectory: fs.existsSync(skillRoot),
      hasSkillFile: fs.existsSync(skillFile),
    };
  });
}

module.exports = {
  SKILLS,
  resolveTarget,
  getSkillStatus,
};
