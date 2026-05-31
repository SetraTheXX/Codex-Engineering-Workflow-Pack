"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonFile } = require("../lib/json");
const { getRunsRoot, validateRunId } = require("../lib/paths");

function findLatestRun(repoRoot = process.cwd()) {
  const runsRoot = getRunsRoot(repoRoot);

  if (!fs.existsSync(runsRoot)) {
    throw new Error(`No CEWP runs found. Missing directory: ${runsRoot}`);
  }

  const runIds = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (runIds.length === 0) {
    throw new Error(`No CEWP runs found under: ${runsRoot}`);
  }

  const runId = runIds[runIds.length - 1];
  return {
    runId,
    runRoot: path.join(runsRoot, runId),
  };
}

function findRun(options = {}, repoRoot = process.cwd()) {
  if (!options.runId) {
    return findLatestRun(repoRoot);
  }

  validateRunId(options.runId);

  const runsRoot = getRunsRoot(repoRoot);
  const runRoot = path.join(runsRoot, options.runId);

  if (!fs.existsSync(runRoot)) {
    throw new Error(`CEWP run not found: ${options.runId}`);
  }

  return {
    runId: options.runId,
    runRoot,
  };
}

function readWorktreesRegistry(runRoot) {
  const registryPath = path.join(runRoot, "worktrees.json");

  if (!fs.existsSync(registryPath)) {
    return undefined;
  }

  const registry = readJsonFile(registryPath, "worktrees registry");

  if (!Array.isArray(registry.worktrees)) {
    throw new Error(`Invalid worktrees registry: ${registryPath}. Missing worktrees array.`);
  }

  return registry;
}

function appendRunEvent(runRoot, role, event) {
  const eventsRoot = path.join(runRoot, "events");
  fs.mkdirSync(eventsRoot, { recursive: true });
  fs.appendFileSync(
    path.join(eventsRoot, `${role}.jsonl`),
    `${JSON.stringify({ timestamp: new Date().toISOString(), role, ...event })}\n`,
  );
}

module.exports = {
  findRun,
  readWorktreesRegistry,
  appendRunEvent,
};
