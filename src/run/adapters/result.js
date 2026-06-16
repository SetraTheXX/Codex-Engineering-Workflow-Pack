"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ADAPTER_RESULT_SCHEMA_VERSION = "adapter-result/v1";

const ARTIFACT_TYPES = {
  stdout: "stdout-log",
  stderr: "stderr-log",
  lastMessage: "last-message",
  report: "report",
  event: "event-log",
  events: "event-log",
  handoff: "manual-handoff",
};

function normalizePath(filePath, runRoot) {
  if (!filePath) {
    return undefined;
  }

  if (runRoot && path.isAbsolute(filePath)) {
    const relativePath = path.relative(runRoot, filePath);
    if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      return relativePath.replace(/\\/g, "/");
    }
  }

  return String(filePath).replace(/\\/g, "/");
}

function getArtifactPresence(filePath, runRoot) {
  if (!filePath) {
    return false;
  }

  if (path.isAbsolute(filePath)) {
    return fs.existsSync(filePath);
  }

  if (runRoot) {
    return fs.existsSync(path.join(runRoot, filePath));
  }

  return false;
}

function buildArtifacts({ role, paths = {}, runRoot } = {}) {
  return Object.keys(ARTIFACT_TYPES)
    .filter((key) => paths[key])
    .map((key) => ({
      type: ARTIFACT_TYPES[key],
      role,
      path: normalizePath(paths[key], runRoot),
      present: getArtifactPresence(paths[key], runRoot),
    }));
}

function normalizeAdapterResult({
  provider,
  role,
  status,
  exitCode,
  timedOut,
  reason,
  reasons,
  paths,
  decision,
  runRoot,
  commandExecuted,
  externalCommandExecuted,
  capabilitiesUsed,
} = {}) {
  const normalizedReasons = Array.isArray(reasons)
    ? reasons.filter((value) => typeof value === "string" && value.length > 0)
    : [];
  const firstReason = reason || normalizedReasons[0];
  const normalizedStatus = status || (normalizedReasons.length > 0 ? "FAIL" : "PASS");
  const normalizedPaths = paths || {};
  const didExecuteCommand = commandExecuted === undefined
    ? typeof exitCode === "number"
    : Boolean(commandExecuted);
  const didExecuteExternalCommand = externalCommandExecuted === undefined
    ? didExecuteCommand
    : Boolean(externalCommandExecuted);

  return {
    schemaVersion: ADAPTER_RESULT_SCHEMA_VERSION,
    provider,
    adapter: provider,
    role,
    status: normalizedStatus,
    ok: normalizedStatus === "PASS",
    exitCode: typeof exitCode === "number" ? exitCode : undefined,
    timedOut: Boolean(timedOut),
    reason: firstReason,
    reasons: normalizedReasons,
    commandExecuted: didExecuteCommand,
    externalCommandExecuted: didExecuteExternalCommand,
    artifacts: buildArtifacts({ role, paths: normalizedPaths, runRoot }),
    lastMessagePath: normalizePath(normalizedPaths.lastMessage, runRoot),
    capabilitiesUsed: Array.isArray(capabilitiesUsed) ? capabilitiesUsed : [],
    paths: normalizedPaths,
    decision,
  };
}

module.exports = {
  ADAPTER_RESULT_SCHEMA_VERSION,
  normalizeAdapterResult,
};
