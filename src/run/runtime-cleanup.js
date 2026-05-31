"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonFile } = require("../lib/json");
const { findLatestRun, findRun } = require("./runtime");

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
  findLatestRun,
  findRun,
  readWorktreesRegistry,
  appendRunEvent,
};
