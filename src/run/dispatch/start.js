"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("../../lib/json");
const { getGitStatusShort, isGitWorktreePath } = require("../../lib/git");
const { findRun, readWorktreesRegistry } = require("../runtime-cleanup");
const {
  quote,
  relativeRunPath,
  getDispatchWorktree,
  readTasks,
  safeDispatchPromptFileName,
} = require("./shared");

function runDispatchStart(options = {}) {
  if (!options.dryRun) {
    throw new Error("dispatch start currently supports --dry-run only.");
  }

  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskEntries = readTasks(runRoot);
  const worktreesRegistry = readWorktreesRegistry(runRoot);
  const dispatchPromptsRoot = path.join(runRoot, "dispatch-prompts");
  const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
  const failures = [];
  const warnings = [];
  const previews = [];

  if (!runJson) {
    failures.push("run.json missing.");
  }

  if (!boardJson) {
    failures.push("board.json missing.");
  }

  if (taskEntries.length === 0) {
    failures.push("tasks not found. Ask the Manager to create tasks first.");
  }

  if (!worktreesRegistry) {
    failures.push("worktrees.json missing. Run cewp run worktrees create first.");
  }

  if (!fs.existsSync(dispatchPromptsRoot)) {
    failures.push(`dispatch-prompts directory missing. Run: cewp run dispatch prompts --run ${runId}`);
  }

  for (const { task } of taskEntries) {
    const taskId = task.id || "unknown-task";
    const assignedRole = task.assignedRole || "unassigned";
    const worktree = getDispatchWorktree(worktreesRegistry, task.id);
    const promptPath = path.join(dispatchPromptsRoot, safeDispatchPromptFileName(assignedRole, taskId));
    const reportPath = path.join(runRoot, "reports", `${assignedRole}-report.md`);
    const eventPath = path.join(runRoot, "events", `${assignedRole}.jsonl`);
    let worktreeReady = false;

    if (!task.id) {
      failures.push("task file missing required id.");
    }

    if (!task.assignedRole) {
      failures.push(`${taskId} assignedRole missing.`);
    }

    if (!worktree) {
      failures.push(`${taskId} matching worktree missing in worktrees.json.`);
    } else if (!worktree.path) {
      failures.push(`${taskId} worktree path missing.`);
    } else if (!fs.existsSync(worktree.path)) {
      failures.push(`${taskId} worktree path does not exist: ${worktree.path}`);
    } else if (!isGitWorktreePath(worktree.path)) {
      failures.push(`${taskId} path is not a git worktree: ${worktree.path}`);
    } else {
      worktreeReady = true;
      const statusLines = getGitStatusShort(worktree.path);
      if (statusLines.length > 0) {
        warnings.push(`${taskId} worktree is dirty.`);
      }
    }

    if (!fs.existsSync(promptPath)) {
      failures.push(`${taskId} dispatch prompt missing: ${relativeRunPath(runRoot, promptPath)}`);
    }

    previews.push({
      taskId,
      assignedRole,
      worktreePath: worktree && worktree.path,
      worktreeReady,
      promptPath,
      reportPath,
      eventPath,
    });
  }

  const reviewerPromptPath = path.join(dispatchPromptsRoot, "reviewer-prompt.md");
  const reviewerReportPath = path.join(runRoot, "reviews", "reviewer-report.md");
  const reviewerEventPath = path.join(runRoot, "events", "reviewer.jsonl");

  if (!fs.existsSync(reviewerPromptPath)) {
    failures.push(`reviewer dispatch prompt missing: ${relativeRunPath(runRoot, reviewerPromptPath)}`);
  }

  if (!fs.existsSync(reviewPacketPath)) {
    warnings.push(`review packet missing: ${relativeRunPath(runRoot, reviewPacketPath)}`);
  }

  console.log("CEWP Coordinator Mode dispatch start dry-run");
  console.log(`Run ID: ${runId}`);
  console.log("Mode: dry-run only");
  console.log("");
  console.log("Approval gate:");
  console.log("  This command did not start agents.");
  console.log("  Worker execution still requires explicit user approval.");
  console.log("");

  console.log(`Readiness: ${failures.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS"}`);
  console.log("");

  if (failures.length > 0) {
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    console.log("");
  }

  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
    console.log("");
  }

  console.log("Workers:");
  if (previews.length === 0) {
    console.log("  none");
  }

  for (const preview of previews) {
    console.log("");
    console.log(`${preview.taskId} / ${preview.assignedRole}`);
    console.log(`  Worktree: ${preview.worktreePath || "missing"}`);
    console.log(`  Prompt bundle: ${relativeRunPath(runRoot, preview.promptPath)}`);
    console.log(`  Report output: ${relativeRunPath(runRoot, preview.reportPath)}`);
    console.log(`  Event log: ${relativeRunPath(runRoot, preview.eventPath)}`);
    console.log("  Manual action:");
    console.log(`    Open Codex in ${quote(preview.worktreePath || "<missing-worktree>")}`);
    console.log(`    Paste prompt from ${quote(relativeRunPath(runRoot, preview.promptPath))}`);
  }
  console.log("");

  console.log("Reviewer:");
  console.log(`  Prompt bundle: ${relativeRunPath(runRoot, reviewerPromptPath)}`);
  console.log(`  Input packet: ${relativeRunPath(runRoot, reviewPacketPath)}`);
  console.log(`  Output: ${relativeRunPath(runRoot, reviewerReportPath)}`);
  console.log("  Manual action:");
  console.log(`    Open Codex in ${quote((runJson && runJson.repoRoot) || process.cwd())}`);
  console.log(`    Paste reviewer prompt from ${quote(relativeRunPath(runRoot, reviewerPromptPath))}`);
  console.log("");

  console.log("Adapter preview:");
  console.log("  manual: supported now");
  console.log("  codex-exec: use dispatch exec or dispatch pipeline with --dry-run/--yes");
  console.log("");
  console.log("No processes were started.");
  console.log("No files were changed.");

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDispatchStart,
};
