"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("../../lib/json");
const { findRun, readWorktreesRegistry } = require("../runtime-cleanup");
const {
  quote,
  formatList,
  relativeRunPath,
  getPromptPath,
  getDispatchWorktree,
  printDispatchPath,
  readTasks,
} = require("./shared");

function runDispatchPlan(options = {}) {
  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskEntries = readTasks(runRoot);
  const worktreesRegistry = readWorktreesRegistry(runRoot);
  const warnings = [];
  const promptRoles = ["manager", "worker-a", "worker-b", "reviewer"];

  console.log("CEWP Coordinator Mode dispatch plan");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log("");

  console.log("Approval gate:");
  console.log("  This command does not start agents.");
  console.log("  Review this plan before worker execution.");
  console.log("");

  console.log("Run context:");
  console.log(`  Run status: ${(runJson && runJson.status) || "unknown"}`);
  console.log(`  Board status: ${(boardJson && boardJson.status) || "unknown"}`);
  console.log(`  Repo root: ${(runJson && runJson.repoRoot) || process.cwd()}`);
  console.log("");

  console.log("Agents:");
  for (const role of promptRoles) {
    const promptPath = getPromptPath(runRoot, role);
    console.log(`  ${role}`);
    if (!fs.existsSync(promptPath)) {
      warnings.push(`prompt file missing for ${role}: ${relativeRunPath(runRoot, promptPath)}`);
    }
  }
  console.log("");

  console.log("Tasks:");
  if (taskEntries.length === 0) {
    console.log("  none");
    warnings.push("tasks not found. Ask the Manager to create tasks first.");
  }

  if (!worktreesRegistry) {
    warnings.push("worktrees.json missing. Run cewp run worktrees create after reviewing the worktree plan.");
  }

  for (const { task } of taskEntries) {
    const taskId = task.id || "unknown-task";
    const assignedRole = task.assignedRole || "unassigned";
    const promptPath = getPromptPath(runRoot, assignedRole);
    const reportPath = path.join(runRoot, "reports", `${assignedRole}-report.md`);
    const eventPath = path.join(runRoot, "events", `${assignedRole}.jsonl`);
    const worktree = getDispatchWorktree(worktreesRegistry, task.id);
    const worktreePath = worktree && worktree.path;
    const branch = (worktree && worktree.branch) || task.branch || "unknown";

    console.log(`  ${taskId} -> ${assignedRole}`);
    console.log(`    Title: ${task.title || "(untitled)"}`);
    console.log(`    Status: ${task.status || "unknown"}`);
    console.log(`    Worktree: ${worktreePath || "missing"}`);
    console.log(`    Branch: ${branch}`);
    printDispatchPath("Prompt", promptPath, runRoot);
    printDispatchPath("Report", reportPath, runRoot);
    printDispatchPath("Event log", eventPath, runRoot);
    console.log(`    allowedFiles: ${formatList(task.allowedFiles)}`);
    console.log(`    forbiddenFiles: ${formatList(task.forbiddenFiles)}`);
    console.log("    Adapter preview:");
    console.log(`      manual: open Codex in ${quote(worktreePath || "<missing-worktree>")} and paste ${quote(relativeRunPath(runRoot, promptPath))}`);
    console.log("      codex-exec: planned, not implemented");
    console.log("");

    if (!task.assignedRole) {
      warnings.push(`${taskId} assignedRole missing.`);
    }

    if (!worktree) {
      warnings.push(`${taskId} matching worktree missing in worktrees.json.`);
    } else if (!worktree.path) {
      warnings.push(`${taskId} worktree path missing.`);
    } else if (!fs.existsSync(worktree.path)) {
      warnings.push(`${taskId} worktree path does not exist: ${worktree.path}`);
    }

    if (!fs.existsSync(promptPath)) {
      warnings.push(`${taskId} prompt file missing for ${assignedRole}: ${relativeRunPath(runRoot, promptPath)}`);
    }

    if (!Array.isArray(task.allowedFiles) || task.allowedFiles.length === 0) {
      warnings.push(`${taskId} allowedFiles is empty.`);
    }

    if (!Array.isArray(task.forbiddenFiles) || task.forbiddenFiles.length === 0) {
      warnings.push(`${taskId} forbiddenFiles is empty.`);
    }
  }

  const reviewerPromptPath = getPromptPath(runRoot, "reviewer");
  const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
  const reviewerReportPath = path.join(runRoot, "reviews", "reviewer-report.md");
  const reviewerEventPath = path.join(runRoot, "events", "reviewer.jsonl");

  console.log("Reviewer:");
  printDispatchPath("Prompt", reviewerPromptPath, runRoot);
  printDispatchPath("Input packet", reviewPacketPath, runRoot);
  printDispatchPath("Output", reviewerReportPath, runRoot);
  printDispatchPath("Event log", reviewerEventPath, runRoot);
  console.log("  Adapter preview:");
  console.log(`    manual: open Codex in ${quote((runJson && runJson.repoRoot) || process.cwd())} and paste ${quote(relativeRunPath(runRoot, reviewerPromptPath))}`);
  console.log("    codex-exec: planned, not implemented");
  console.log("");

  if (!fs.existsSync(reviewerPromptPath)) {
    warnings.push(`reviewer prompt missing: ${relativeRunPath(runRoot, reviewerPromptPath)}`);
  }

  if (!fs.existsSync(reviewPacketPath)) {
    warnings.push(`review packet missing: ${relativeRunPath(runRoot, reviewPacketPath)}`);
  }

  console.log("Warnings:");
  if (warnings.length === 0) {
    console.log("  none");
  } else {
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }
}

module.exports = {
  runDispatchPlan,
};
