"use strict";

const path = require("node:path");
const { normalizeComparePath } = require("../lib/paths");

const OWNERSHIP_SCHEMA_VERSION = "execution-ownership/v1";
const EXECUTION_OWNERS = Object.freeze(["managed", "native", "audit-only"]);
const MANAGED_BACKENDS = Object.freeze(["codex-exec", "app-server"]);
const RELEASED_STATUSES = new Set(["released", "abandoned"]);

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid execution ownership: ${label} is required.`);
  }
  return value;
}

function normalizeWorktreePath(record, repoRoot = process.cwd()) {
  const worktreePath = requiredString(record.worktree && record.worktree.path, "worktree.path");
  return normalizeComparePath(path.resolve(repoRoot, worktreePath));
}

function validateOwnershipRecord(record) {
  if (!record || record.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    throw new Error(`Invalid execution ownership schema. Expected ${OWNERSHIP_SCHEMA_VERSION}.`);
  }

  requiredString(record.runId, "runId");
  requiredString(record.taskId, "taskId");
  requiredString(record.checkpointId, "checkpointId");
  requiredString(record.status, "status");
  requiredString(record.worktree && record.worktree.id, "worktree.id");
  requiredString(record.worktree && record.worktree.path, "worktree.path");

  if (!EXECUTION_OWNERS.includes(record.owner)) {
    throw new Error(`Invalid execution owner: ${record.owner || "missing"}.`);
  }

  if (record.owner === "managed") {
    if (!MANAGED_BACKENDS.includes(record.backend)) {
      throw new Error(`Managed execution requires one supported backend.`);
    }
  } else if (record.backend !== null) {
    throw new Error(`${record.owner} execution must not claim a managed backend.`);
  }

  return record;
}

function sameOperation(left, right) {
  return left.runId === right.runId
    && left.taskId === right.taskId
    && left.checkpointId === right.checkpointId
    && left.owner === right.owner
    && left.backend === right.backend;
}

function findOwnershipConflict(records, requested, options = {}) {
  validateOwnershipRecord(requested);
  const requestedPath = normalizeWorktreePath(requested, options.repoRoot);

  for (const existing of records || []) {
    validateOwnershipRecord(existing);
    if (RELEASED_STATUSES.has(existing.status)) {
      continue;
    }

    const sameTask = existing.runId === requested.runId && existing.taskId === requested.taskId;
    const sameWorktree = existing.worktree.id === requested.worktree.id
      || normalizeWorktreePath(existing, options.repoRoot) === requestedPath;
    if ((sameTask || sameWorktree) && !sameOperation(existing, requested)) {
      return existing;
    }
  }

  return undefined;
}

module.exports = {
  EXECUTION_OWNERS,
  MANAGED_BACKENDS,
  OWNERSHIP_SCHEMA_VERSION,
  findOwnershipConflict,
  normalizeWorktreePath,
  validateOwnershipRecord,
};
