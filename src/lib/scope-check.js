"use strict";

const { getGitStatusShort, getCommittedChangedFiles } = require("./git");
const { normalizeSlashPath, normalizeComparePath } = require("./paths");

function parseChangedFile(statusLine) {
  const rawPath = statusLine.slice(3).trim();
  const renameParts = rawPath.split(" -> ");
  return normalizeSlashPath(renameParts[renameParts.length - 1]);
}

function uniqueFileList(files) {
  const seen = new Set();
  const output = [];

  for (const file of files) {
    const normalized = normalizeSlashPath(file);
    const key = normalizeComparePath(normalized);

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function getWorktreeChangeSummary(worktreePath, baseCommit) {
  const statusLines = getGitStatusShort(worktreePath);
  const statusChangedFiles = statusLines.map(parseChangedFile);
  let committedChangedFiles = [];
  let committedDiffError;

  if (baseCommit) {
    try {
      committedChangedFiles = getCommittedChangedFiles(worktreePath, baseCommit);
    } catch (error) {
      committedDiffError = error;
    }
  }

  return {
    statusLines,
    statusChangedFiles,
    committedChangedFiles,
    committedDiffError,
    missingBaseCommit: !baseCommit,
    changedFiles: uniqueFileList([...statusChangedFiles, ...committedChangedFiles]),
  };
}

function pathMatchesPattern(filePath, pattern) {
  const normalizedFile = normalizeSlashPath(filePath);
  const normalizedPattern = normalizeSlashPath(pattern);

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }

  return normalizedFile === normalizedPattern;
}

function isWorkerRuntimeOutputPath(filePath) {
  const normalizedFile = normalizeSlashPath(filePath);
  return normalizedFile === ".cewp-worker-output" || normalizedFile.startsWith(".cewp-worker-output/");
}

function findScopeWarnings(taskId, changedFiles, task) {
  const warnings = [];
  const allowedFiles = Array.isArray(task.allowedFiles) ? task.allowedFiles : [];
  const forbiddenFiles = Array.isArray(task.forbiddenFiles) ? task.forbiddenFiles : [];

  for (const filePath of changedFiles) {
    if (
      allowedFiles.length > 0 &&
      !isWorkerRuntimeOutputPath(filePath) &&
      !allowedFiles.some((pattern) => pathMatchesPattern(filePath, pattern))
    ) {
      warnings.push(`${taskId} changed file outside allowedFiles: ${filePath}`);
    }

    if (forbiddenFiles.some((pattern) => pathMatchesPattern(filePath, pattern))) {
      warnings.push(`${taskId} changed forbidden file: ${filePath}`);
    }
  }

  return warnings;
}

function normalizeAllowedFileEntry(value) {
  return normalizeSlashPath(value).replace(/\/+$/, "");
}

function isTreePattern(pattern) {
  return pattern === "**" || pattern.endsWith("/**");
}

function treePatternPrefix(pattern) {
  if (pattern === "**") {
    return "";
  }

  return pattern.slice(0, -3);
}

function pathIsWithinTreePattern(fileOrPattern, treePattern) {
  const normalized = normalizeAllowedFileEntry(fileOrPattern);
  const prefix = treePatternPrefix(treePattern);

  if (prefix === "") {
    return true;
  }

  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

function allowedFilePatternsOverlap(leftPattern, rightPattern) {
  const left = normalizeAllowedFileEntry(leftPattern);
  const right = normalizeAllowedFileEntry(rightPattern);

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  if (isTreePattern(left) && pathIsWithinTreePattern(right, left)) {
    return true;
  }

  if (isTreePattern(right) && pathIsWithinTreePattern(left, right)) {
    return true;
  }

  return false;
}

function getAllowedFilesOverlap(taskA, taskB) {
  const allowedA = Array.isArray(taskA.allowedFiles) ? taskA.allowedFiles.map(normalizeAllowedFileEntry).filter(Boolean) : [];
  const allowedB = Array.isArray(taskB.allowedFiles) ? taskB.allowedFiles.map(normalizeAllowedFileEntry).filter(Boolean) : [];
  const overlaps = [];

  for (const left of allowedA) {
    for (const right of allowedB) {
      if (allowedFilePatternsOverlap(left, right)) {
        overlaps.push(left === right ? left : `${left} <-> ${right}`);
      }
    }
  }

  return overlaps;
}

module.exports = {
  parseChangedFile,
  uniqueFileList,
  getWorktreeChangeSummary,
  pathMatchesPattern,
  isWorkerRuntimeOutputPath,
  findScopeWarnings,
  normalizeAllowedFileEntry,
  allowedFilePatternsOverlap,
  getAllowedFilesOverlap,
};
