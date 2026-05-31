"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { listFiles } = require("../../lib/fs");

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function formatList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "none";
  }

  return value.join(", ");
}

function relativeRunPath(runRoot, targetPath) {
  return path.relative(runRoot, targetPath).replace(/\\/g, "/");
}

function getPromptPath(runRoot, role) {
  return path.join(runRoot, "prompts", `${role}-prompt.md`);
}

function getDispatchWorktree(worktreesRegistry, taskId) {
  if (!worktreesRegistry) {
    return undefined;
  }

  return worktreesRegistry.worktrees.find((entry) => entry.taskId === taskId);
}

function printDispatchPath(label, filePath, runRoot) {
  console.log(`    ${label}: ${relativeRunPath(runRoot, filePath)}`);
}

function checkLabel(level) {
  if (level === "fail") {
    return "FAIL";
  }

  if (level === "warn") {
    return "WARN";
  }

  return "OK";
}

function overallDispatchStatus(checks) {
  if (checks.some((check) => check.level === "fail")) {
    return "FAIL";
  }

  if (checks.some((check) => check.level === "warn")) {
    return "WARN";
  }

  return "PASS";
}

function addDispatchCheck(checks, level, message) {
  checks.push({ level, message });
}

function shouldIgnorePromptMissingForPipeline(options, promptPath, role, runRoot) {
  return Boolean(
    options.ignoreMissingDispatchPrompts &&
    promptPath === getPromptPath(runRoot, role)
  );
}

function getTaskReadinessStatus(levels) {
  if (levels.includes("fail")) {
    return "FAIL";
  }

  if (levels.includes("warn")) {
    return "WARN";
  }

  return "PASS";
}

function isSafeBranchName(branch) {
  if (!branch || typeof branch !== "string") {
    return false;
  }

  if (
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.endsWith(".lock") ||
    /[\s\\~^:?\*[\x00-\x1f]/.test(branch)
  ) {
    return false;
  }

  return true;
}

function getTaskBranch(task, runId) {
  const branch = task.branch || `cewp/${runId}/${task.id}`;

  if (!isSafeBranchName(branch)) {
    throw new Error(`Unsafe branch name for ${task.id}: ${branch}`);
  }

  return branch;
}

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

function safeDispatchPromptFileName(role, taskId) {
  return `${role}-${taskId}-prompt.md`.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getWorkerTaskForRole(taskEntries, role) {
  const matches = taskEntries
    .map((entry) => entry.task)
    .filter((task) => task.assignedRole === role);

  if (matches.length === 0) {
    throw new Error(`Cannot create codex-exec preview: no task assigned to ${role}.`);
  }

  if (matches.length > 1) {
    throw new Error(`Cannot create codex-exec preview: multiple tasks assigned to ${role}; this slice supports one task per worker role.`);
  }

  return matches[0];
}

function getDispatchPromptPathForTask(runRoot, role, taskId) {
  return path.join(runRoot, "dispatch-prompts", safeDispatchPromptFileName(role, taskId));
}

module.exports = {
  quote,
  formatList,
  relativeRunPath,
  getPromptPath,
  getDispatchWorktree,
  printDispatchPath,
  checkLabel,
  overallDispatchStatus,
  addDispatchCheck,
  shouldIgnorePromptMissingForPipeline,
  getTaskReadinessStatus,
  getTaskBranch,
  readTasks,
  safeDispatchPromptFileName,
  getWorkerTaskForRole,
  getDispatchPromptPathForTask,
};
