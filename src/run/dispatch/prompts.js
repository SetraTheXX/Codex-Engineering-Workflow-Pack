"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("../../lib/json");
const { findRun, readWorktreesRegistry } = require("../runtime-cleanup");
const { createWorkerDispatchPrompt, createReviewerDispatchPrompt } = require("../templates/dispatch-prompts");
const {
  relativeRunPath,
  getPromptPath,
  getDispatchWorktree,
  readTasks,
  safeDispatchPromptFileName,
} = require("./shared");

function runDispatchPrompts(options = {}) {
  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const taskEntries = readTasks(runRoot);
  const worktreesRegistry = readWorktreesRegistry(runRoot);
  const warnings = [];

  if (taskEntries.length === 0) {
    throw new Error("Cannot create dispatch prompts: no task files found. Ask the Manager to create tasks first.");
  }

  if (!worktreesRegistry) {
    throw new Error("Cannot create dispatch prompts: worktrees.json missing. Run cewp run worktrees create first.");
  }

  const outputRoot = path.join(runRoot, "dispatch-prompts");
  fs.mkdirSync(outputRoot, { recursive: true });

  const created = [];

  for (const { task } of taskEntries) {
    const taskId = task.id || "unknown-task";
    const assignedRole = task.assignedRole || "unassigned";
    const worktree = getDispatchWorktree(worktreesRegistry, task.id);
    const basePromptPath = getPromptPath(runRoot, assignedRole);

    if (!worktree) {
      throw new Error(`Cannot create dispatch prompts: ${taskId} matching worktree missing in worktrees.json.`);
    }

    if (!worktree.path) {
      throw new Error(`Cannot create dispatch prompts: ${taskId} worktree path missing.`);
    }

    if (!fs.existsSync(basePromptPath)) {
      warnings.push(`${taskId} base prompt missing for ${assignedRole}; generated dispatch prompt from built-in template.`);
    }

    const filePath = path.join(outputRoot, safeDispatchPromptFileName(assignedRole, taskId));
    fs.writeFileSync(filePath, createWorkerDispatchPrompt({
      runId,
      runRoot,
      runJson,
      task,
      worktree,
    }));
    created.push(filePath);
  }

  const reviewerPromptPath = getPromptPath(runRoot, "reviewer");
  const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");

  if (!fs.existsSync(reviewerPromptPath)) {
    warnings.push("reviewer base prompt missing; generated dispatch prompt from built-in template.");
  }

  if (!fs.existsSync(reviewPacketPath)) {
    warnings.push("review packet missing; reviewer dispatch prompt was still created.");
  }

  const reviewerDispatchPath = path.join(outputRoot, "reviewer-prompt.md");
  fs.writeFileSync(reviewerDispatchPath, createReviewerDispatchPrompt({
    runId,
    runRoot,
    runJson,
    worktreesRegistry,
  }));
  created.push(reviewerDispatchPath);

  console.log("CEWP Coordinator Mode dispatch prompts");
  console.log(`Run ID: ${runId}`);
  console.log("");
  console.log("Created:");
  for (const filePath of created) {
    console.log(`  ${relativeRunPath(runRoot, filePath)}`);
  }
  console.log("");

  console.log("Warnings:");
  if (warnings.length === 0) {
    console.log("  none");
  } else {
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log("");

  console.log("Next:");
  console.log(`  Review with: cewp run dispatch check --run ${runId}`);
  console.log("  Paste each dispatch prompt into the matching Codex session manually.");
  console.log("  This command did not start agents.");

  return {
    runId,
    created,
    warnings,
  };
}

module.exports = {
  runDispatchPrompts,
};
