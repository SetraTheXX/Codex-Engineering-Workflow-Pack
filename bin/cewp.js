#!/usr/bin/env node

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

function usage() {
  console.log(`Codex Engineering Workflow Pack

Usage:
  cewp init [--mode repo|global] [--target <path>] [--force]
  cewp --help

Defaults:
  cewp init = cewp init --mode repo --target <current working directory>

Examples:
  cewp init
  cewp init --mode repo
  cewp init --mode repo --target "C:\\path\\to\\repo"
  cewp init --mode repo --target "/path/to/repo" --force
  cewp init --mode global
  cewp init --mode global --force
`);
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    mode: "repo",
    target: undefined,
    force: false,
    help: false,
  };

  if (argv[0] === "--help" || argv[0] === "-h") {
    args.command = undefined;
    args.help = true;
    return args;
  }

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--mode") {
      args.mode = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--target") {
      args.target = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

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
  if (options.mode !== "repo" && options.mode !== "global") {
    throw new Error("--mode must be repo or global.");
  }

  if (options.mode === "global" && options.target) {
    throw new Error("--target is only supported with --mode repo.");
  }

  const packageRoot = path.resolve(__dirname, "..");
  const sourceRoot = path.join(packageRoot, ".agents", "skills");

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source skills folder not found: ${sourceRoot}`);
  }

  const repoTarget = path.resolve(options.target || process.cwd());

  if (options.mode === "repo" && !fs.existsSync(repoTarget)) {
    throw new Error(`Target repo path does not exist: ${repoTarget}`);
  }

  const targetRoot =
    options.mode === "global"
      ? path.join(os.homedir(), ".agents", "skills")
      : path.join(repoTarget, ".agents", "skills");

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

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (!args.command || args.help) {
      usage();
      return;
    }

    if (args.command !== "init") {
      throw new Error(`Unsupported command: ${args.command}`);
    }

    init(args);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error("");
    usage();
    process.exitCode = 1;
  }
}

main();
