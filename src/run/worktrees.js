"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeJson, readJsonIfExists } = require("../lib/json");
const { listFiles } = require("../lib/fs");
const {
  getGitOutput,
  isRepoDirty,
  branchExists,
  getGitHeadCommit,
  getGitBranchName,
  isGitWorktreePath,
} = require("../lib/git");
const { getWorktreeChangeSummary, isWorkerRuntimeOutputPath, findScopeWarnings } = require("../lib/scope-check");
const { findRun, readWorktreesRegistry, appendRunEvent } = require("./runtime-cleanup");

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function formatList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "none";
  }

  return value.join(", ");
}

function getRepoName(repoRoot = process.cwd()) {
  return path.basename(path.resolve(repoRoot));
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

function isUnsafeWorktreePath(worktreePath) {
  if (!worktreePath || typeof worktreePath !== "string") {
    return true;
  }

  if (worktreePath.includes("\0")) {
    return true;
  }

  const normalized = worktreePath.replace(/\\/g, "/");
  const segments = normalized.split("/");

  if (normalized.startsWith("../.cewp-worktrees/")) {
    return segments.slice(2).some((segment) => segment === "..");
  }

  return segments.some((segment) => segment === "..");
}

function getTaskWorktreePath(task, runId, repoRoot) {
  const repoName = getRepoName(repoRoot);
  const worktreePath = task.targetWorktree || `../.cewp-worktrees/${repoName}/${runId}/${task.id}`;

  if (isUnsafeWorktreePath(worktreePath)) {
    throw new Error(`Unsafe targetWorktree for ${task.id}: ${worktreePath}`);
  }

  return worktreePath;
}

function resolveWorktreePath(worktreePath, repoRoot = process.cwd()) {
  return path.resolve(repoRoot, worktreePath);
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

function getTaskMap(runRoot) {
  return new Map(readTasks(runRoot).map(({ task }) => [task.id, task]));
}

function buildWorktreePlans(runId, runRoot) {
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const repoRoot = (runJson && runJson.repoRoot) || process.cwd();
  const taskEntries = readTasks(runRoot);
  const baseCommit = getGitHeadCommit(repoRoot);

  const plans = taskEntries.map(({ task }) => {
    if (!task.id) {
      throw new Error("Task file is missing required field: id.");
    }

    const branch = getTaskBranch(task, runId);
    const targetWorktree = getTaskWorktreePath(task, runId, repoRoot);
    const resolvedPath = resolveWorktreePath(targetWorktree, repoRoot);

    return {
      task,
      branch,
      targetWorktree,
      resolvedPath,
      baseCommit,
      targetExists: fs.existsSync(resolvedPath),
      branchExists: branchExists(repoRoot, branch),
    };
  });

  return {
    repoRoot,
    taskEntries,
    plans,
  };
}

function runWorktreesPlan(options = {}) {
  const { runId, runRoot } = findRun(options);
  const { taskEntries, plans } = buildWorktreePlans(runId, runRoot);

  console.log("CEWP Coordinator Mode worktree plan");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Task count: ${taskEntries.length}`);
  console.log("");

  if (taskEntries.length === 0) {
    console.log("No task files found. Ask the Manager to create tasks first.");
    return;
  }

  for (const plan of plans) {
    console.log(`Task: ${plan.task.id}`);
    console.log(`  Title: ${plan.task.title || "(untitled)"}`);
    console.log(`  Assigned role: ${plan.task.assignedRole || "unassigned"}`);
    console.log(`  Status: ${plan.task.status || "unknown"}`);
    console.log(`  Branch: ${plan.branch}`);
    console.log(`  Target worktree: ${plan.targetWorktree}`);
    console.log(`  Resolved path: ${plan.resolvedPath}`);
    console.log(`  Allowed files: ${formatList(plan.task.allowedFiles)}`);
    console.log(`  Forbidden files: ${formatList(plan.task.forbiddenFiles)}`);
    console.log(`  Target path exists: ${plan.targetExists ? "yes" : "no"}`);
    console.log(`  Branch exists: ${plan.branchExists ? "yes" : "no"}`);
    console.log("");
  }

  console.log("Suggested manual commands:");
  for (const plan of plans) {
    console.log(`  git worktree add ${quote(plan.resolvedPath)} -b ${quote(plan.branch)}`);
  }
}

function getWorktreePreflightErrors(plans) {
  const errors = [];
  const seenPaths = new Map();
  const seenBranches = new Map();

  for (const plan of plans) {
    const pathKey = process.platform === "win32" ? plan.resolvedPath.toLowerCase() : plan.resolvedPath;

    if (seenPaths.has(pathKey)) {
      errors.push(`${plan.task.id}: duplicate target path also used by ${seenPaths.get(pathKey)}: ${plan.resolvedPath}`);
    } else {
      seenPaths.set(pathKey, plan.task.id);
    }

    if (seenBranches.has(plan.branch)) {
      errors.push(`${plan.task.id}: duplicate branch also used by ${seenBranches.get(plan.branch)}: ${plan.branch}`);
    } else {
      seenBranches.set(plan.branch, plan.task.id);
    }

    if (plan.targetExists) {
      errors.push(`${plan.task.id}: target path already exists: ${plan.resolvedPath}`);
    }

    if (plan.branchExists) {
      errors.push(`${plan.task.id}: branch already exists: ${plan.branch}`);
    }
  }

  return errors;
}

function printWorktreeCreatePlan({ runId, runRoot, repoRoot, plans, dryRun }) {
  console.log("CEWP Coordinator Mode worktree create");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "create"}`);
  console.log(`Task count: ${plans.length}`);
  console.log("");

  for (const plan of plans) {
    console.log(`Task: ${plan.task.id}`);
    console.log(`  Branch: ${plan.branch}`);
    console.log(`  Path: ${plan.resolvedPath}`);
    console.log(`  Target path exists: ${plan.targetExists ? "yes" : "no"}`);
    console.log(`  Branch exists: ${plan.branchExists ? "yes" : "no"}`);
    console.log(`  Command: git worktree add ${quote(plan.resolvedPath)} -b ${quote(plan.branch)}`);
    console.log("");
  }
}

function writeWorktreesRegistry(runRoot, runId, created) {
  writeJson(path.join(runRoot, "worktrees.json"), {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    worktrees: created.map((entry) => ({
      taskId: entry.task.id,
      assignedRole: entry.task.assignedRole || "unassigned",
      branch: entry.branch,
      path: entry.resolvedPath,
      status: "created",
      baseCommit: entry.baseCommit,
    })),
  });
}

function runWorktreesCreate(options = {}) {
  const { runId, runRoot } = findRun(options);
  const { repoRoot, taskEntries, plans } = buildWorktreePlans(runId, runRoot);

  printWorktreeCreatePlan({
    runId,
    runRoot,
    repoRoot,
    plans,
    dryRun: options.dryRun,
  });

  if (taskEntries.length === 0) {
    console.log("No task files found. Ask the Manager to create tasks first.");
    return;
  }

  const preflightErrors = getWorktreePreflightErrors(plans);

  if (options.dryRun) {
    console.log(`Main repo dirty: ${isRepoDirty(repoRoot) ? "yes" : "no"}`);
    console.log("");

    if (preflightErrors.length > 0) {
      console.log("Preflight issues:");
      for (const error of preflightErrors) {
        console.log(`  - ${error}`);
      }
    } else {
      console.log("Dry run only. No worktrees created and no registry written.");
    }

    return;
  }

  if (isRepoDirty(repoRoot)) {
    throw new Error("Cannot create worktrees while main repo has uncommitted changes.");
  }

  if (preflightErrors.length > 0) {
    throw new Error(`Worktree preflight failed:\n${preflightErrors.map((error) => `- ${error}`).join("\n")}`);
  }

  const created = [];

  for (const plan of plans) {
    const result = getGitOutput(["worktree", "add", plan.resolvedPath, "-b", plan.branch], repoRoot);

    if (result.status !== 0) {
      const details = (result.stderr || result.stdout || "").trim();
      throw new Error(
        `Failed to create worktree for ${plan.task.id}. Created before failure: ${created.length}. ${details}`,
      );
    }

    created.push(plan);
  }

  writeWorktreesRegistry(runRoot, runId, created);
  appendRunEvent(runRoot, "cli", {
    event: "worktrees-created",
    runId,
    count: created.length,
    worktrees: created.map((plan) => ({
      taskId: plan.task.id,
      branch: plan.branch,
      path: plan.resolvedPath,
      baseCommit: plan.baseCommit,
    })),
  });

  console.log(`Created worktree count: ${created.length}`);
  for (const plan of created) {
    console.log(`  ${plan.task.id}: created`);
    console.log(`    branch: ${plan.branch}`);
    console.log(`    path: ${plan.resolvedPath}`);
    console.log(`    baseCommit: ${plan.baseCommit}`);
  }
  console.log("");
  console.log("Next:");
  console.log("  cewp run worktrees plan");
  console.log("  cewp run worktrees status");
}

function runWorktreesStatus(options = {}) {
  const { runId, runRoot } = findRun(options);
  const registry = readWorktreesRegistry(runRoot);

  if (!registry) {
    throw new Error("No worktrees.json found. Run cewp run worktrees create first.");
  }

  const taskMap = getTaskMap(runRoot);
  const warnings = [];

  console.log("CEWP Coordinator Mode worktree status");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log("");
  console.log(`Worktrees: ${registry.worktrees.length}`);
  console.log("");

  for (const entry of registry.worktrees) {
    const taskId = entry.taskId || "unknown-task";
    const task = taskMap.get(taskId);
    const assignedRole = (task && task.assignedRole) || entry.assignedRole || "unassigned";
    const exists = Boolean(entry.path && fs.existsSync(entry.path));
    const isGitWorktree = exists ? isGitWorktreePath(entry.path) : false;

    console.log(`${taskId} / ${assignedRole}`);
    console.log(`  Branch: ${entry.branch || "unknown"}`);
    console.log(`  Path: ${entry.path || "unknown"}`);
    console.log(`  Exists: ${exists ? "yes" : "no"}`);
    console.log(`  Git worktree: ${isGitWorktree ? "yes" : "no"}`);

    if (!task) {
      warnings.push(`${taskId} has no matching task JSON.`);
    } else {
      console.log(`  Task status: ${task.status || "unknown"}`);
      console.log(`  Allowed files: ${formatList(task.allowedFiles)}`);
      console.log(`  Forbidden files: ${formatList(task.forbiddenFiles)}`);
    }

    if (!exists) {
      console.log("  Git status: missing");
      console.log("  Changed files: none");
      console.log("  Scope: WARN");
      warnings.push(`${taskId} worktree path is missing: ${entry.path || "unknown"}`);
      console.log("");
      continue;
    }

    if (!isGitWorktree) {
      console.log("  Git status: not a git worktree");
      console.log("  Changed files: none");
      console.log("  Scope: WARN");
      warnings.push(`${taskId} path is not a git worktree: ${entry.path}`);
      console.log("");
      continue;
    }

    const branchName = getGitBranchName(entry.path);
    const changeSummary = getWorktreeChangeSummary(entry.path, entry.baseCommit);
    const statusLines = changeSummary.statusLines;
    const scopeWarnings = task ? findScopeWarnings(taskId, changeSummary.changedFiles, task) : [];
    warnings.push(...scopeWarnings);

    if (changeSummary.missingBaseCommit) {
      warnings.push(`${taskId} worktree registry missing baseCommit; committed branch changes were not collected.`);
    }

    if (changeSummary.committedDiffError) {
      warnings.push(`${taskId} committed diff check failed: ${changeSummary.committedDiffError.message}`);
    }

    console.log(`  Current branch: ${branchName}`);
    console.log(`  Git status: ${statusLines.length === 0 ? "clean" : "dirty"}`);
    console.log(`  Base commit: ${entry.baseCommit || "missing"}`);

    console.log("  Changed files:");
    console.log("    Working tree:");
    if (statusLines.length === 0) {
      console.log("      none");
    } else {
      for (const line of statusLines) {
        console.log(`      ${line}`);
      }
    }

    console.log("    Committed since baseCommit:");
    if (changeSummary.committedDiffError) {
      console.log(`      failed to collect: ${changeSummary.committedDiffError.message}`);
    } else if (changeSummary.missingBaseCommit) {
      console.log("      skipped: worktrees.json entry missing baseCommit");
    } else if (changeSummary.committedChangedFiles.length === 0) {
      console.log("      none");
    } else {
      for (const filePath of changeSummary.committedChangedFiles) {
        console.log(`      ${filePath}`);
      }
    }

    console.log("    Combined:");
    if (changeSummary.changedFiles.length === 0) {
      console.log("      none");
    } else {
      for (const filePath of changeSummary.changedFiles) {
        console.log(`      ${filePath}${isWorkerRuntimeOutputPath(filePath) ? " (runtime output)" : ""}`);
      }
    }

    const scopeStatus =
      scopeWarnings.length === 0 && !changeSummary.missingBaseCommit && !changeSummary.committedDiffError ? "OK" : "WARN";
    console.log(`  Scope: ${scopeStatus}`);
    console.log("");
  }

  console.log("Warnings:");

  if (warnings.length === 0) {
    console.log("  none");
  } else {
    for (const warning of warnings) {
      console.log(`  ${warning}`);
    }
  }
}

module.exports = {
  runWorktreesPlan,
  runWorktreesCreate,
  runWorktreesStatus,
};
