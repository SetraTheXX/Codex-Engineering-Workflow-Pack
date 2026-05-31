"use strict";

const path = require("node:path");

function getRunRoot(runId, repoRoot = process.cwd()) {
  return path.join(path.resolve(repoRoot), ".cewp", "runs", runId);
}

function getRunsRoot(repoRoot = process.cwd()) {
  return path.join(path.resolve(repoRoot), ".cewp", "runs");
}

function validateRunId(runId) {
  if (!/^\d{8}-\d{6}$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}. Expected format: YYYYMMDD-HHMMSS.`);
  }
}

function normalizeSlashPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function normalizeComparePath(filePath) {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

module.exports = {
  getRunRoot,
  getRunsRoot,
  validateRunId,
  normalizeSlashPath,
  normalizeComparePath,
};
