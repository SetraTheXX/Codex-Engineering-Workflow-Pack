"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("../lib/json");
const { listFiles } = require("../lib/fs");
const {
  getGitBranchName,
  isGitWorktreePath,
  getGitDiffStat,
} = require("../lib/git");
const {
  getWorktreeChangeSummary,
  findScopeWarnings,
} = require("../lib/scope-check");
const { findRun, readWorktreesRegistry, appendRunEvent } = require("./runtime-cleanup");
const { makeReviewPacket } = require("./review-packet");

function readTaskFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid task JSON: ${filePath}. ${error.message}`);
  }
}

function readTasks(runRoot) {
  return listFiles(path.join(runRoot, "tasks"), ".json").map((filePath) => ({
    filePath,
    task: readTaskFile(filePath),
  }));
}

function getEventTimeMs(event) {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const value = event.timestamp || event.time;
  if (!value) {
    return undefined;
  }

  const timeMs = Date.parse(value);
  return Number.isNaN(timeMs) ? undefined : timeMs;
}

function getWorktreeSnapshot(entry, taskMap) {
  const taskId = entry.taskId || "unknown-task";
  const task = taskMap.get(taskId);
  const assignedRole = (task && task.assignedRole) || entry.assignedRole || "unassigned";
  const exists = Boolean(entry.path && fs.existsSync(entry.path));
  const isGitWorktree = exists ? isGitWorktreePath(entry.path) : false;
  const warnings = [];
  let branchName = "unknown";
  let statusLines = [];
  let statusChangedFiles = [];
  let committedChangedFiles = [];
  let committedDiffError;
  let changedFiles = [];
  let diffStat = "(not collected)";
  let gitStatus = "missing";

  if (!task) {
    warnings.push(`${taskId} has no matching task JSON.`);
  }

  if (!exists) {
    warnings.push(`${taskId} worktree path is missing: ${entry.path || "unknown"}`);
  } else if (!isGitWorktree) {
    gitStatus = "not a git worktree";
    warnings.push(`${taskId} path is not a git worktree: ${entry.path}`);
  } else {
    branchName = getGitBranchName(entry.path);
    const changeSummary = getWorktreeChangeSummary(entry.path, entry.baseCommit);
    statusLines = changeSummary.statusLines;
    statusChangedFiles = changeSummary.statusChangedFiles;
    committedChangedFiles = changeSummary.committedChangedFiles;
    committedDiffError = changeSummary.committedDiffError;
    changedFiles = changeSummary.changedFiles;
    diffStat = getGitDiffStat(entry.path);
    gitStatus = statusLines.length === 0 ? "clean" : "dirty";

    if (changeSummary.missingBaseCommit) {
      warnings.push(`${taskId} worktree registry missing baseCommit; committed branch changes were not collected.`);
    }

    if (committedDiffError) {
      warnings.push(`${taskId} committed diff check failed: ${committedDiffError.message}`);
    }

    if (task) {
      warnings.push(...findScopeWarnings(taskId, changedFiles, task));
    }
  }

  return {
    taskId,
    task,
    assignedRole,
    branch: entry.branch || "unknown",
    baseCommit: entry.baseCommit,
    branchName,
    path: entry.path || "unknown",
    exists,
    isGitWorktree,
    gitStatus,
    statusLines,
    statusChangedFiles,
    committedChangedFiles,
    committedDiffError,
    changedFiles,
    diffStat,
    warnings,
  };
}

function getRecentEvents(runRoot, warnings, limit = 10) {
  const eventFiles = listFiles(path.join(runRoot, "events"), ".jsonl");
  const events = [];

  for (const filePath of eventFiles) {
    const lines = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        events.push({
          file: path.basename(filePath),
          value,
          timeMs: getEventTimeMs(value) || 0,
        });
      } catch {
        warnings.push(`Invalid event JSONL line in ${path.basename(filePath)}: ${line}`);
      }
    }
  }

  return events
    .sort((left, right) => left.timeMs - right.timeMs)
    .slice(-limit);
}

function runCollect(options = {}) {
  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskEntries = readTasks(runRoot);
  const tasks = taskEntries.map(({ task }) => task);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const registry = readWorktreesRegistry(runRoot);
  const reportFiles = listFiles(path.join(runRoot, "reports"), ".md");
  const reviewFiles = listFiles(path.join(runRoot, "reviews"), ".md");
  const warnings = [];

  if (tasks.length === 0) {
    warnings.push("No task files found.");
  }

  if (!registry) {
    warnings.push("No worktrees.json found. Worktree diffs were not collected.");
  }

  if (reportFiles.length === 0) {
    warnings.push("No worker report files found.");
  }

  if (reviewFiles.length === 0) {
    warnings.push("No reviewer report files found.");
  }

  const worktreeSnapshots = registry
    ? registry.worktrees.map((entry) => getWorktreeSnapshot(entry, taskMap))
    : [];
  for (const snapshot of worktreeSnapshots) {
    warnings.push(...snapshot.warnings);
  }

  const recentEvents = getRecentEvents(runRoot, warnings);
  const packet = makeReviewPacket({
    runId,
    runRoot,
    runJson,
    boardJson,
    tasks,
    registry,
    worktreeSnapshots,
    reportFiles,
    reviewFiles,
    recentEvents,
    warnings,
  });
  const packetRoot = path.join(runRoot, "review-packets");
  const packetPath = path.join(packetRoot, "review-packet.md");

  fs.mkdirSync(packetRoot, { recursive: true });
  fs.writeFileSync(packetPath, packet);
  appendRunEvent(runRoot, "cli", {
    event: "collect_created",
    runId,
    packetPath,
    warnings: warnings.length,
  });

  console.log("CEWP review packet created");
  console.log(`Run ID: ${runId}`);
  console.log(`Packet: ${packetPath}`);
  console.log(`Warnings: ${warnings.length}`);

  return {
    runId,
    packetPath,
    warnings,
  };
}

module.exports = {
  runCollect,
};
