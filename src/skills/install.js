"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SKILLS, resolveTarget } = require("./paths");

function copySkill(sourceSkill, targetSkill, force) {
  if (fs.existsSync(targetSkill) && !force) {
    return "skipped";
  }

  fs.mkdirSync(targetSkill, { recursive: true });
  fs.cpSync(sourceSkill, targetSkill, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  return "copied";
}

function init(options) {
  const packageRoot = path.resolve(__dirname, "..", "..");
  const sourceRoot = path.join(packageRoot, ".agents", "skills");

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source skills folder not found: ${sourceRoot}`);
  }

  const targetRoot = resolveTarget(options, { announceDefault: true });

  fs.mkdirSync(targetRoot, { recursive: true });

  const copied = [];
  const skipped = [];

  for (const skill of SKILLS) {
    const sourceSkill = path.join(sourceRoot, skill);
    const targetSkill = path.join(targetRoot, skill);

    if (!fs.existsSync(sourceSkill)) {
      console.warn(`Warning: missing source skill: ${skill}`);
      continue;
    }

    const result = copySkill(sourceSkill, targetSkill, options.force);
    if (result === "copied") {
      copied.push(skill);
      console.log(`Copied: ${skill}`);
    } else {
      skipped.push(skill);
      console.warn(`Skipping existing skill without --force: ${skill}`);
    }
  }

  console.log("");
  console.log("Install summary");
  console.log(`Mode: ${options.mode}`);
  console.log(`Source: ${sourceRoot}`);
  console.log(`Target: ${targetRoot}`);
  console.log(`Copied: ${copied.length ? copied.join(", ") : "none"}`);
  console.log(`Skipped: ${skipped.length ? skipped.join(", ") : "none"}`);
  console.log("");
  console.log("Restart or reload Codex so it can discover installed skills.");
}

module.exports = {
  init,
};
