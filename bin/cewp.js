#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { readJsonIfExists, readJsonFile } = require("../src/lib/json");
const { listFiles } = require("../src/lib/fs");
const {
  getGitOutput,
  isRepoDirty,
  branchExists,
  getGitHeadCommit,
  isGitWorktreePath,
} = require("../src/lib/git");
const { getRunRoot, getRunsRoot, validateRunId, normalizeComparePath } = require("../src/lib/paths");
const {
  uniqueFileList,
  getWorktreeChangeSummary,
  isWorkerRuntimeOutputPath,
  findScopeWarnings,
  getAllowedFilesOverlap,
} = require("../src/lib/scope-check");
const { runCleanup } = require("../src/run/cleanup");
const { runPrune } = require("../src/run/prune");
const {
  runWorktreesPlan,
  runWorktreesCreate,
  runWorktreesStatus,
} = require("../src/run/worktrees");
const {
  runInit,
  runStatus,
  runPrompts,
  runPrompt,
} = require("../src/run/basic");
const { runFinalize } = require("../src/run/finalize");
const { runCollect } = require("../src/run/collect");
const { usage } = require("../src/cli/usage");
const { parseArgs } = require("../src/cli/parse");
const { printCliError } = require("../src/cli/errors");
const { init } = require("../src/skills/install");
const { list, doctor } = require("../src/skills/status");

function findLatestRun(repoRoot = process.cwd()) {
  const runsRoot = getRunsRoot(repoRoot);

  if (!fs.existsSync(runsRoot)) {
    throw new Error(`No CEWP runs found. Missing directory: ${runsRoot}`);
  }

  const runIds = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (runIds.length === 0) {
    throw new Error(`No CEWP runs found under: ${runsRoot}`);
  }

  const runId = runIds[runIds.length - 1];
  return {
    runId,
    runRoot: path.join(runsRoot, runId),
  };
}

function findRun(options = {}, repoRoot = process.cwd()) {
  if (!options.runId) {
    return findLatestRun(repoRoot);
  }

  validateRunId(options.runId);

  const runsRoot = getRunsRoot(repoRoot);
  const runRoot = path.join(runsRoot, options.runId);

  if (!fs.existsSync(runRoot)) {
    throw new Error(`CEWP run not found: ${options.runId}`);
  }

  return {
    runId: options.runId,
    runRoot,
  };
}

function getRepoName(repoRoot = process.cwd()) {
  return path.basename(path.resolve(repoRoot));
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
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

function appendRunEvent(runRoot, role, event) {
  const eventsRoot = path.join(runRoot, "events");
  fs.mkdirSync(eventsRoot, { recursive: true });
  fs.appendFileSync(
    path.join(eventsRoot, `${role}.jsonl`),
    `${JSON.stringify({ timestamp: new Date().toISOString(), role, ...event })}\n`,
  );
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

function runDispatchCheck(options = {}) {
  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskEntries = readTasks(runRoot);
  const worktreesRegistry = readWorktreesRegistry(runRoot);
  const checks = [];
  const taskReadiness = [];
  const supportedWorkers = ["worker-a", "worker-b"];

  if (runJson) {
    addDispatchCheck(checks, "ok", "run.json found");
  } else {
    addDispatchCheck(checks, "fail", "run.json missing");
  }

  if (boardJson) {
    addDispatchCheck(checks, "ok", "board.json found");
  } else {
    addDispatchCheck(checks, "fail", "board.json missing");
  }

  if (taskEntries.length > 0) {
    addDispatchCheck(checks, "ok", `tasks found: ${taskEntries.length}`);
  } else {
    addDispatchCheck(checks, "fail", "tasks not found. Ask the Manager to create tasks first.");
  }

  if (worktreesRegistry) {
    addDispatchCheck(checks, "ok", "worktrees registry found");
  } else {
    addDispatchCheck(checks, "fail", "worktrees.json missing. Run cewp run worktrees create before dispatch.");
  }

  if ((runJson && runJson.reviewer) || (boardJson && boardJson.roles && boardJson.roles.reviewer)) {
    addDispatchCheck(checks, "ok", "reviewer role configured");
  } else {
    addDispatchCheck(checks, "fail", "reviewer role missing from run/board state");
  }

  for (const role of supportedWorkers) {
    const promptPath = getPromptPath(runRoot, role);
    const ignorePromptMissing = shouldIgnorePromptMissingForPipeline(options, promptPath, role, runRoot);
    addDispatchCheck(
      checks,
      fs.existsSync(promptPath) || ignorePromptMissing ? "ok" : "fail",
      `${role} prompt ${fs.existsSync(promptPath) ? "found" : ignorePromptMissing ? "will be generated by dispatch prompts" : `missing: ${relativeRunPath(runRoot, promptPath)}`}`,
    );
  }

  const reviewerPromptPath = getPromptPath(runRoot, "reviewer");
  const ignoreReviewerPromptMissing = shouldIgnorePromptMissingForPipeline(options, reviewerPromptPath, "reviewer", runRoot);
  addDispatchCheck(
    checks,
    fs.existsSync(reviewerPromptPath) || ignoreReviewerPromptMissing ? "ok" : "fail",
    `reviewer prompt ${fs.existsSync(reviewerPromptPath) ? "found" : ignoreReviewerPromptMissing ? "will be generated by dispatch prompts" : `missing: ${relativeRunPath(runRoot, reviewerPromptPath)}`}`,
  );

  const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
  addDispatchCheck(
    checks,
    fs.existsSync(reviewPacketPath) ? "ok" : "warn",
    fs.existsSync(reviewPacketPath)
      ? "review packet found"
      : `review packet missing: ${relativeRunPath(runRoot, reviewPacketPath)}`,
  );

  const reviewerReportPath = path.join(runRoot, "reviews", "reviewer-report.md");
  const reviewerEventPath = path.join(runRoot, "events", "reviewer.jsonl");
  addDispatchCheck(checks, "ok", `reviewer output path ready: ${relativeRunPath(runRoot, reviewerReportPath)}`);
  addDispatchCheck(checks, "ok", `reviewer event path ready: ${relativeRunPath(runRoot, reviewerEventPath)}`);

  for (const { task } of taskEntries) {
    const taskId = task.id || "unknown-task";
    const levels = [];
    const addTaskLevel = (level) => levels.push(level);
    const worktree = getDispatchWorktree(worktreesRegistry, task.id);
    const assignedRole = task.assignedRole;

    if (task.id) {
      addDispatchCheck(checks, "ok", `${taskId} task id found`);
      addTaskLevel("ok");
    } else {
      addDispatchCheck(checks, "fail", "task file missing required id");
      addTaskLevel("fail");
    }

    if (assignedRole) {
      addDispatchCheck(checks, "ok", `${taskId} assignedRole: ${assignedRole}`);
      addTaskLevel("ok");
    } else {
      addDispatchCheck(checks, "fail", `${taskId} assignedRole missing`);
      addTaskLevel("fail");
    }

    if (assignedRole && supportedWorkers.includes(assignedRole)) {
      addDispatchCheck(checks, "ok", `${taskId} assignedRole supported`);
      addTaskLevel("ok");
    } else if (assignedRole) {
      addDispatchCheck(checks, "fail", `${taskId} assignedRole unsupported: ${assignedRole}`);
      addTaskLevel("fail");
    }

    try {
      const branch = task.id ? getTaskBranch(task, runId) : undefined;
      if (branch) {
        addDispatchCheck(checks, "ok", `${taskId} branch ready: ${branch}`);
        addTaskLevel("ok");
      }
    } catch (error) {
      addDispatchCheck(checks, "fail", `${taskId} branch invalid: ${error.message}`);
      addTaskLevel("fail");
    }

    if (worktree) {
      addDispatchCheck(checks, "ok", `${taskId} matching worktree registry entry found`);
      addTaskLevel("ok");
    } else {
      addDispatchCheck(checks, "fail", `${taskId} matching worktree registry entry missing`);
      addTaskLevel("fail");
    }

    if (worktree && worktree.path) {
      addDispatchCheck(checks, "ok", `${taskId} worktree path registered`);
      addTaskLevel("ok");

      if (fs.existsSync(worktree.path)) {
        addDispatchCheck(checks, "ok", `${taskId} worktree path exists`);
        addTaskLevel("ok");

        if (isGitWorktreePath(worktree.path)) {
          addDispatchCheck(checks, "ok", `${taskId} path is a git worktree`);
          addTaskLevel("ok");

          const changeSummary = getWorktreeChangeSummary(worktree.path, worktree.baseCommit);
          if (changeSummary.statusLines.length > 0) {
            addDispatchCheck(checks, "warn", `${taskId} worktree is dirty`);
            addTaskLevel("warn");
          } else {
            addDispatchCheck(checks, "ok", `${taskId} worktree is clean`);
            addTaskLevel("ok");
          }

          if (changeSummary.missingBaseCommit) {
            addDispatchCheck(checks, "fail", `${taskId} worktree registry missing baseCommit; committed diff check cannot run`);
            addTaskLevel("fail");
          } else if (changeSummary.committedDiffError) {
            addDispatchCheck(checks, "fail", `${taskId} committed diff check failed: ${changeSummary.committedDiffError.message}`);
            addTaskLevel("fail");
          } else {
            addDispatchCheck(checks, "ok", `${taskId} committed diff check ready`);
            addTaskLevel("ok");
          }
        } else {
          addDispatchCheck(checks, "fail", `${taskId} path is not a git worktree: ${worktree.path}`);
          addTaskLevel("fail");
        }
      } else {
        addDispatchCheck(checks, "fail", `${taskId} worktree path missing: ${worktree.path}`);
        addTaskLevel("fail");
      }
    } else if (worktree) {
      addDispatchCheck(checks, "fail", `${taskId} worktree path missing`);
      addTaskLevel("fail");
    }

    const promptPath = assignedRole ? getPromptPath(runRoot, assignedRole) : undefined;
    if (promptPath && (fs.existsSync(promptPath) || shouldIgnorePromptMissingForPipeline(options, promptPath, assignedRole, runRoot))) {
      addDispatchCheck(checks, "ok", `${taskId} prompt file ${fs.existsSync(promptPath) ? "found" : "will be generated by dispatch prompts"}`);
      addTaskLevel("ok");
    } else {
      addDispatchCheck(checks, "fail", `${taskId} prompt file missing`);
      addTaskLevel("fail");
    }

    const reportPath = assignedRole ? path.join(runRoot, "reports", `${assignedRole}-report.md`) : undefined;
    const eventPath = assignedRole ? path.join(runRoot, "events", `${assignedRole}.jsonl`) : undefined;
    addDispatchCheck(checks, reportPath ? "ok" : "fail", `${taskId} report path ${reportPath ? "ready" : "not computable"}`);
    addDispatchCheck(checks, eventPath ? "ok" : "fail", `${taskId} event path ${eventPath ? "ready" : "not computable"}`);
    addTaskLevel(reportPath ? "ok" : "fail");
    addTaskLevel(eventPath ? "ok" : "fail");

    if (Array.isArray(task.allowedFiles) && task.allowedFiles.length > 0) {
      addDispatchCheck(checks, "ok", `${taskId} allowedFiles configured`);
      addTaskLevel("ok");
    } else {
      addDispatchCheck(checks, "warn", `${taskId} allowedFiles is empty`);
      addTaskLevel("warn");
    }

    if (Array.isArray(task.forbiddenFiles) && task.forbiddenFiles.length > 0) {
      addDispatchCheck(checks, "ok", `${taskId} forbiddenFiles configured`);
      addTaskLevel("ok");
    } else {
      addDispatchCheck(checks, "warn", `${taskId} forbiddenFiles is empty`);
      addTaskLevel("warn");
    }

    taskReadiness.push({
      taskId,
      assignedRole: assignedRole || "unassigned",
      status: getTaskReadinessStatus(levels),
    });
  }

  const reviewerLevels = [];
  reviewerLevels.push(fs.existsSync(reviewerPromptPath) || ignoreReviewerPromptMissing ? "ok" : "fail");
  reviewerLevels.push(fs.existsSync(reviewPacketPath) ? "ok" : "warn");
  reviewerLevels.push(reviewerReportPath ? "ok" : "fail");
  reviewerLevels.push(reviewerEventPath ? "ok" : "fail");

  const status = overallDispatchStatus(checks);

  console.log("CEWP Coordinator Mode dispatch check");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log("");
  console.log(`Status: ${status}`);
  console.log("");

  console.log("Checks:");
  for (const check of checks) {
    console.log(`  [${checkLabel(check.level)}] ${check.message}`);
  }
  console.log("");

  console.log("Task readiness:");
  if (taskReadiness.length === 0) {
    console.log("  none");
  } else {
    for (const task of taskReadiness) {
      console.log(`  ${task.taskId} / ${task.assignedRole}: ${task.status}`);
    }
  }
  console.log("");

  console.log("Reviewer readiness:");
  console.log(`  reviewer: ${getTaskReadinessStatus(reviewerLevels)}`);
  console.log(`    Output: ${relativeRunPath(runRoot, reviewerReportPath)}`);
  console.log(`    Event log: ${relativeRunPath(runRoot, reviewerEventPath)}`);
  console.log("");

  console.log("Next:");
  if (status === "FAIL") {
    console.log("  Fix FAIL checks before worker dispatch.");
  } else {
    console.log("  If PASS, worker dispatch can be considered after user approval.");
    console.log("  WARN items should be reviewed before dispatch.");
  }
  console.log("  This command did not start agents.");

  if (status === "FAIL") {
    process.exitCode = 1;
  }

  return status;
}

function markdownArray(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "- none";
  }

  return value.map((item) => `- ${item}`).join("\n");
}

function createWorkerDispatchPrompt({ runId, runRoot, runJson, task, worktree }) {
  const assignedRole = task.assignedRole || "unassigned";
  const reportPath = path.join(runRoot, "reports", `${assignedRole}-report.md`);
  const eventPath = path.join(runRoot, "events", `${assignedRole}.jsonl`);
  const workerOutputReport = `.cewp-worker-output/${assignedRole}-report.md`;
  const workerOutputEvents = `.cewp-worker-output/${assignedRole}-events.jsonl`;

  return `# CEWP Dispatch Prompt - Worker

Role: ${assignedRole}
Task: ${task.id}
Run ID: ${runId}
Repo root: ${(runJson && runJson.repoRoot) || process.cwd()}
Run root: ${runRoot}
Worktree path: ${worktree.path}
Branch: ${worktree.branch || task.branch || "unknown"}

## Mission
${task.mission || "Complete the assigned task exactly as described in the task metadata."}

## Task Metadata
- title: ${task.title || "(untitled)"}
- status: ${task.status || "unknown"}
- assignedRole: ${assignedRole}
- dependsOn: ${Array.isArray(task.dependsOn) && task.dependsOn.length ? task.dependsOn.join(", ") : "none"}
- allowedFiles:
${markdownArray(task.allowedFiles)}
- forbiddenFiles:
${markdownArray(task.forbiddenFiles)}
- verification:
${markdownArray(task.verification)}

## Hard Rules
- Work only inside the assigned worktree.
- Do not write board.json.
- Do not edit tasks/*.json.
- Do not edit files outside allowedFiles when allowedFiles is non-empty.
- Do not touch forbiddenFiles.
- Do not merge.
- Do not push.
- Do not publish.
- Do not spawn Codex processes.
- Do not automate terminal input.

## Required Outputs
Write inside your assigned worktree:
- ${workerOutputReport}
- ${workerOutputEvents}

Do not write directly to:
- ${relativeRunPath(runRoot, reportPath)}
- ${relativeRunPath(runRoot, eventPath)}

The CLI will copy worker output into the run directory after execution.

## Report Template
\`\`\`md
# Worker Report

Role: ${assignedRole}
Task: ${task.id}
Status: ready_for_review | blocked

## Summary

## Changed Files

## Commands Run

## Test Results

## Risks

## Handoff Notes
\`\`\`
`;
}

function createReviewerDispatchPrompt({ runId, runRoot, runJson, worktreesRegistry }) {
  const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
  const reviewerReportPath = path.join(runRoot, "reviews", "reviewer-report.md");
  const reviewerEventPath = path.join(runRoot, "events", "reviewer.jsonl");
  const worktreeLines = worktreesRegistry.worktrees.length === 0
    ? "- none"
    : worktreesRegistry.worktrees
      .map((entry) => `- ${entry.taskId || "unknown-task"} / ${entry.assignedRole || "unassigned"}: ${entry.path || "missing path"}`)
      .join("\n");

  return `# CEWP Dispatch Prompt - Reviewer

Run ID: ${runId}
Repo root: ${(runJson && runJson.repoRoot) || process.cwd()}
Run root: ${runRoot}
Review packet: ${reviewPacketPath}
Worktrees:
${worktreeLines}

## Mission
Review worker output without blindly trusting reports.

## Inputs
- board.json
- tasks/*.json
- reports/*.md
- worktrees status
- review-packets/review-packet.md

## Required Output
- ${relativeRunPath(runRoot, reviewerReportPath)}
- ${relativeRunPath(runRoot, reviewerEventPath)}

## Decision Format
Decision: PASS | REQUEST_CHANGES | BLOCK

## Reviewer Checklist
- Compare worker reports against actual git diff output.
- Check allowedFiles and forbiddenFiles for every task.
- Check verification commands and test output claims.
- Check scope creep and unexpected files.
- Do not implement production feature work.
- Do not merge, push, publish, spawn Codex processes, or automate terminal input.
`;
}

function safeDispatchPromptFileName(role, taskId) {
  return `${role}-${taskId}-prompt.md`.replace(/[^a-zA-Z0-9._-]/g, "-");
}

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
  console.log("  codex-exec: planned, not implemented");
  console.log("");
  console.log("No processes were started.");
  console.log("No files were changed.");

  if (failures.length > 0) {
    process.exitCode = 1;
  }
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

function printCodexExecPreview({ cwd, promptPath, outputPath, sandbox }) {
  console.log("PowerShell preview:");
  console.log(`  $prompt = Get-Content -Raw ${quote(promptPath)}`);
  console.log(`  codex exec --cd ${quote(cwd)} --sandbox ${sandbox} --output-last-message ${quote(outputPath)} $prompt`);
}

function getDispatchExecPreview(options) {
  const supportedRoles = ["worker-a", "worker-b", "reviewer"];
  const shouldPrint = options.printPreview !== false;

  if (!options.adapter) {
    throw new Error("dispatch exec requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }

  if (!supportedRoles.includes(options.role)) {
    throw new Error(`Unsupported dispatch exec role: ${options.role || "(missing)"}. Supported roles: worker-a, worker-b, reviewer.`);
  }

  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskEntries = readTasks(runRoot);
  const worktreesRegistry = readWorktreesRegistry(runRoot);
  const dispatchPromptsRoot = path.join(runRoot, "dispatch-prompts");
  const adapterOutputRoot = path.join(runRoot, "adapter-output");
  const outputLastMessagePath = path.join(adapterOutputRoot, `${options.role}-last-message.md`);
  const failures = [];
  const warnings = [];
  let preview;

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
    if (options.ignoreMissingDispatchPrompts) {
      warnings.push(`dispatch-prompts directory missing; pipeline will run dispatch prompts before execution.`);
    } else {
      failures.push(`dispatch-prompts directory missing. Run: cewp run dispatch prompts --run ${runId}`);
    }
  }

  if (options.role === "reviewer") {
    const promptPath = path.join(dispatchPromptsRoot, "reviewer-prompt.md");
    const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
    const reportPath = path.join(runRoot, "reviews", "reviewer-report.md");
    const eventPath = path.join(runRoot, "events", "reviewer.jsonl");
    const workdir = runRoot;
    const reportFiles = listFiles(path.join(runRoot, "reports"), ".md");

    if (!fs.existsSync(promptPath)) {
      if (options.ignoreMissingDispatchPrompts) {
        warnings.push(`reviewer dispatch prompt missing; pipeline will create it before reviewer execution.`);
      } else {
        failures.push(`reviewer dispatch prompt missing: ${relativeRunPath(runRoot, promptPath)}`);
      }
    }

    if (!fs.existsSync(reviewPacketPath)) {
      if (options.ignoreMissingReviewInputs) {
        warnings.push(`review packet missing; pipeline will run collect before reviewer execution.`);
      } else {
        failures.push(`review packet missing: ${relativeRunPath(runRoot, reviewPacketPath)}. Run cewp run collect first.`);
      }
    }

    if (reportFiles.length === 0) {
      if (options.ignoreMissingReviewInputs) {
        warnings.push("worker reports missing; pipeline will run workers before reviewer execution.");
      } else {
        failures.push("worker reports missing. Run worker execution before reviewer execution.");
      }
    }

    if (!fs.existsSync(workdir)) {
      failures.push(`reviewer working directory missing: ${workdir}`);
    }

    preview = {
      role: options.role,
      cwd: workdir,
      promptPath,
      reportPath,
      eventPath,
      outputLastMessagePath,
      sandbox: "workspace-write",
      reviewPacketPath,
      reportFiles,
    };
  } else if (taskEntries.length > 0) {
    const task = getWorkerTaskForRole(taskEntries, options.role);
    const taskId = task.id || "unknown-task";
    const worktree = getDispatchWorktree(worktreesRegistry, task.id);
    const promptPath = getDispatchPromptPathForTask(runRoot, options.role, taskId);
    const reportPath = path.join(runRoot, "reports", `${options.role}-report.md`);
    const eventPath = path.join(runRoot, "events", `${options.role}.jsonl`);

    if (!task.id) {
      failures.push("task file missing required id.");
    }

    if (!worktree) {
      failures.push(`${taskId} matching worktree missing in worktrees.json.`);
    } else if (!worktree.path) {
      failures.push(`${taskId} worktree path missing.`);
    } else if (!fs.existsSync(worktree.path)) {
      failures.push(`${taskId} worktree path does not exist: ${worktree.path}`);
    } else if (!isGitWorktreePath(worktree.path)) {
      failures.push(`${taskId} path is not a git worktree: ${worktree.path}`);
    }

    if (worktree && !worktree.baseCommit) {
      warnings.push(`${taskId} worktree registry missing baseCommit; committed diff post-check will fail safely.`);
    }

    if (!fs.existsSync(promptPath)) {
      if (options.ignoreMissingDispatchPrompts) {
        warnings.push(`${taskId} dispatch prompt missing; pipeline will create it before worker execution.`);
      } else {
        failures.push(`${taskId} dispatch prompt missing: ${relativeRunPath(runRoot, promptPath)}`);
      }
    }

    preview = {
      role: options.role,
      task,
      worktree,
      cwd: worktree && worktree.path,
      promptPath,
      reportPath,
      eventPath,
      outputLastMessagePath,
      sandbox: "workspace-write",
    };
  }

  if (shouldPrint) {
    console.log("CEWP Coordinator Mode codex-exec adapter dry-run");
    console.log(`Run ID: ${runId}`);
    console.log(`Role: ${options.role}`);
    console.log(`Adapter: ${options.adapter}`);
    console.log(`Mode: ${options.dryRun ? "dry-run" : "execution"}`);
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

    if (preview) {
      if (preview.task) {
        console.log("Task:");
        console.log(`  ${preview.task.id || "unknown-task"} / ${preview.role}`);
        console.log(`  Title: ${preview.task.title || "(untitled)"}`);
        console.log(`  Branch: ${(preview.worktree && preview.worktree.branch) || preview.task.branch || "unknown"}`);
        console.log("");
        console.log("Worktree:");
        console.log(`  ${preview.cwd || "missing"}`);
        console.log("");
      } else {
        console.log("Reviewer:");
        console.log(`  Workdir: ${preview.cwd}`);
        console.log("  Sandbox: workspace-write");
        console.log(`  Review packet: ${relativeRunPath(runRoot, preview.reviewPacketPath)}`);
        console.log(`  Worker reports: ${preview.reportFiles.length}`);
        console.log("");
      }

      console.log("Prompt:");
      console.log(`  ${relativeRunPath(runRoot, preview.promptPath)}`);
      console.log("");
      console.log("Expected outputs:");
      if (preview.task && preview.cwd) {
        const workerOutput = getWorkerOutputPaths(preview.cwd, preview.role);
        console.log(`  Worker report source: ${path.relative(preview.cwd, workerOutput.reportPath).replace(/\\/g, "/")}`);
        console.log(`  Worker events source: ${path.relative(preview.cwd, workerOutput.eventsPath).replace(/\\/g, "/")}`);
      }
      console.log(`  Report: ${relativeRunPath(runRoot, preview.reportPath)}`);
      console.log(`  Event log: ${relativeRunPath(runRoot, preview.eventPath)}`);
      console.log(`  Last message: ${relativeRunPath(runRoot, preview.outputLastMessagePath)}`);
      console.log("");
      console.log("Recommended execution strategy:");
      console.log("  Pass prompt content to codex exec from the dispatch prompt file.");
      console.log("  Do not inline the full prompt in a shell command.");
      console.log("");
      printCodexExecPreview({
        cwd: preview.cwd || "<missing-workdir>",
        promptPath: preview.promptPath,
        outputPath: preview.outputLastMessagePath,
        sandbox: preview.sandbox,
      });
      console.log("");
    }

    console.log("Post-checks:");
    console.log("  git status --short");
    console.log("  git diff --name-only <baseCommit>...HEAD");
    console.log("  allowedFiles / forbiddenFiles");
    console.log("  report exists");
    console.log("  adapter output exists");
    console.log("  no merge/push/publish");
    console.log("");
    console.log("No processes were started.");
    console.log("No files were changed.");
  }

  return {
    runId,
    runRoot,
    runJson,
    taskEntries,
    failures,
    warnings,
    preview,
  };
}

function writeAdapterLog(filePath, value) {
  fs.writeFileSync(filePath, value || "");
}

function getWorkerOutputPaths(worktreePath, role) {
  const outputRoot = path.join(worktreePath, ".cewp-worker-output");
  return {
    outputRoot,
    reportPath: path.join(outputRoot, `${role}-report.md`),
    eventsPath: path.join(outputRoot, `${role}-events.jsonl`),
  };
}

function copyWorkerOutputToRun({ runRoot, role, localReportPath, localEventsPath }) {
  const reportPath = path.join(runRoot, "reports", `${role}-report.md`);
  const eventPath = path.join(runRoot, "events", `${role}.jsonl`);
  const copied = {
    report: false,
    events: false,
    reportPath,
    eventPath,
  };

  if (fs.existsSync(localReportPath)) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.copyFileSync(localReportPath, reportPath);
    copied.report = true;
  }

  if (fs.existsSync(localEventsPath)) {
    const eventContent = fs.readFileSync(localEventsPath, "utf8");
    if (eventContent.trim().length > 0) {
      fs.mkdirSync(path.dirname(eventPath), { recursive: true });
      fs.appendFileSync(eventPath, eventContent.endsWith("\n") ? eventContent : `${eventContent}\n`);
      copied.events = true;
    }
  }

  return copied;
}

function runCodexExec({ worktreePath, promptPath, outputLastMessagePath, timeoutSeconds, sandbox = "workspace-write" }) {
  const prompt = fs.readFileSync(promptPath, "utf8");
  return childProcess.spawnSync("codex", [
    "exec",
    "--cd",
    worktreePath,
    "--sandbox",
    sandbox,
    "--output-last-message",
    outputLastMessagePath,
    prompt,
  ], {
    cwd: worktreePath,
    encoding: "utf8",
    shell: false,
    timeout: timeoutSeconds * 1000,
    windowsHide: true,
  });
}

function getRepoStatusForReviewer(repoRoot) {
  if (!repoRoot || !fs.existsSync(repoRoot) || !isGitWorktreePath(repoRoot)) {
    return [];
  }

  return getGitStatusShort(repoRoot);
}

function runDispatchReviewerExecActual(options, preflight) {
  const { runId, runRoot, runJson, failures, warnings, preview } = preflight;

  if (failures.length > 0) {
    console.log("CEWP Coordinator Mode codex-exec reviewer execution");
    console.log(`Run ID: ${runId}`);
    console.log("Role: reviewer");
    console.log("Adapter: codex-exec");
    console.log("");
    console.log("Preflight: FAIL");
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    console.log("");
    console.log("No processes were started.");
    console.log("No merge/push/publish was performed.");
    process.exitCode = 1;
    return "FAIL";
  }

  const repoRoot = (runJson && runJson.repoRoot) || process.cwd();
  const repoStatusBefore = getRepoStatusForReviewer(repoRoot);
  const adapterOutputRoot = path.join(runRoot, "adapter-output");
  fs.mkdirSync(adapterOutputRoot, { recursive: true });

  console.log("");
  console.log("Executing codex exec reviewer...");
  const execResult = runCodexExec({
    worktreePath: preview.cwd,
    promptPath: preview.promptPath,
    outputLastMessagePath: preview.outputLastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
    sandbox: "workspace-write",
  });

  const stdoutPath = path.join(adapterOutputRoot, "reviewer-stdout.log");
  const stderrPath = path.join(adapterOutputRoot, "reviewer-stderr.log");
  writeAdapterLog(stdoutPath, execResult.stdout);
  writeAdapterLog(stderrPath, execResult.stderr);

  const reportExists = fs.existsSync(preview.reportPath);
  const lastMessageExists = fs.existsSync(preview.outputLastMessagePath);
  const eventExists = fs.existsSync(preview.eventPath);
  const decision = reportExists ? findReviewerDecisionStrict(preview.reportPath) : undefined;
  const timedOut = Boolean(execResult.error && execResult.error.code === "ETIMEDOUT");
  const exitCode = typeof execResult.status === "number" ? execResult.status : 1;
  const repoStatusAfter = getRepoStatusForReviewer(repoRoot);
  const repoChanged = repoStatusBefore.join("\n") !== repoStatusAfter.join("\n");
  const failuresAfterExec = [];
  const warningsAfterExec = [];

  if (timedOut) {
    failuresAfterExec.push(`codex exec timed out after ${options.timeoutSeconds}s.`);
  }

  if (exitCode !== 0) {
    failuresAfterExec.push(`codex exec exited with code ${exitCode}.`);
  }

  if (!reportExists) {
    failuresAfterExec.push(`reviewer report missing: ${relativeRunPath(runRoot, preview.reportPath)}`);
  } else if (!decision) {
    failuresAfterExec.push("reviewer report does not contain Decision: PASS | REQUEST_CHANGES | BLOCK");
  }

  if (!lastMessageExists) {
    failuresAfterExec.push(`adapter output missing: ${relativeRunPath(runRoot, preview.outputLastMessagePath)}`);
  }

  if (repoChanged) {
    failuresAfterExec.push("public repo git status changed during reviewer execution.");
  }

  if (!eventExists) {
    warningsAfterExec.push(`reviewer event log missing: ${relativeRunPath(runRoot, preview.eventPath)}`);
  }

  const status = failuresAfterExec.length > 0 ? "FAIL" : "PASS";
  appendRunEvent(runRoot, "cli", {
    event: status === "PASS" ? "dispatch_exec_completed" : "dispatch_exec_failed",
    runId,
    adapter: "codex-exec",
    role: "reviewer",
    exitCode,
    status,
    decision: decision || "not_found",
  });

  console.log("");
  console.log("CEWP Coordinator Mode codex-exec reviewer execution");
  console.log(`Run ID: ${runId}`);
  console.log("Role: reviewer");
  console.log("Adapter: codex-exec");
  console.log("");
  console.log(`Preflight: ${warnings.length > 0 ? "WARN" : "PASS"}`);
  console.log(`Execution: ${exitCode === 0 && !timedOut ? "PASS" : "FAIL"}`);
  console.log(`Exit code: ${exitCode}`);
  console.log(`Timeout: ${options.timeoutSeconds}s`);
  console.log(`Decision: ${decision || "not found"}`);
  console.log(`Report: ${reportExists ? `found ${relativeRunPath(runRoot, preview.reportPath)}` : `missing ${relativeRunPath(runRoot, preview.reportPath)}`}`);
  console.log(`Event log: ${eventExists ? relativeRunPath(runRoot, preview.eventPath) : "not provided"}`);
  console.log(`Last message: ${lastMessageExists ? relativeRunPath(runRoot, preview.outputLastMessagePath) : "missing"}`);
  console.log(`Stdout log: ${relativeRunPath(runRoot, stdoutPath)}`);
  console.log(`Stderr log: ${relativeRunPath(runRoot, stderrPath)}`);
  console.log(`Public repo changed: ${repoChanged ? "yes" : "no"}`);
  console.log("");
  console.log(`Status: ${status}`);

  if (failuresAfterExec.length > 0) {
    console.log("Reasons:");
    for (const failure of failuresAfterExec) {
      console.log(`  - ${failure}`);
    }
  }

  if (warningsAfterExec.length > 0) {
    console.log("Warnings:");
    for (const warning of warningsAfterExec) {
      console.log(`  - ${warning}`);
    }
  }

  console.log("");
  console.log("No merge/push/publish was performed.");

  if (status === "FAIL") {
    process.exitCode = 1;
  }

  return status;
}

function runDispatchExecActual(options = {}) {
  if (!options.adapter) {
    throw new Error("dispatch exec requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }

  const result = getDispatchExecPreview({ ...options, dryRun: false, printPreview: false });
  const { runId, runRoot, failures, warnings, preview } = result;

  if (options.role === "reviewer") {
    return runDispatchReviewerExecActual(options, result);
  }

  if (failures.length > 0) {
    console.log("CEWP Coordinator Mode codex-exec execution");
    console.log(`Run ID: ${runId}`);
    console.log(`Role: ${options.role}`);
    console.log("Adapter: codex-exec");
    console.log("");
    console.log("Preflight: FAIL");
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    console.log("");
    console.log("No processes were started.");
    console.log("No merge/push/publish was performed.");
    process.exitCode = 1;
    return "FAIL";
  }

  const adapterOutputRoot = path.join(runRoot, "adapter-output");
  fs.mkdirSync(adapterOutputRoot, { recursive: true });

  console.log("");
  console.log("Executing codex exec...");
  const execResult = runCodexExec({
    worktreePath: preview.cwd,
    promptPath: preview.promptPath,
    outputLastMessagePath: preview.outputLastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
  });

  const stdoutPath = path.join(adapterOutputRoot, `${options.role}-stdout.log`);
  const stderrPath = path.join(adapterOutputRoot, `${options.role}-stderr.log`);
  writeAdapterLog(stdoutPath, execResult.stdout);
  writeAdapterLog(stderrPath, execResult.stderr);

  const workerOutput = getWorkerOutputPaths(preview.cwd, options.role);
  const copiedOutput = copyWorkerOutputToRun({
    runRoot,
    role: options.role,
    localReportPath: workerOutput.reportPath,
    localEventsPath: workerOutput.eventsPath,
  });
  const statusLines = getGitStatusShort(preview.cwd);
  const statusChangedFiles = statusLines.map(parseChangedFile);
  let committedChangedFiles = [];
  let committedDiffError;
  if (preview.worktree.baseCommit) {
    try {
      committedChangedFiles = getCommittedChangedFiles(preview.cwd, preview.worktree.baseCommit);
    } catch (error) {
      committedDiffError = error;
    }
  }
  const changedFiles = uniqueFileList([...statusChangedFiles, ...committedChangedFiles]);
  const runtimeOutputFiles = changedFiles.filter(isWorkerRuntimeOutputPath);
  const scopeWarnings = findScopeWarnings(preview.task.id || "unknown-task", changedFiles, preview.task);
  const forbiddenWarnings = scopeWarnings.filter((warning) => warning.includes("changed forbidden file"));
  const outsideAllowedWarnings = scopeWarnings.filter((warning) => warning.includes("outside allowedFiles"));
  const reportExists = fs.existsSync(preview.reportPath);
  const localReportExists = fs.existsSync(workerOutput.reportPath);
  const localEventsExist = fs.existsSync(workerOutput.eventsPath);
  const lastMessageExists = fs.existsSync(preview.outputLastMessagePath);
  const timedOut = Boolean(execResult.error && execResult.error.code === "ETIMEDOUT");
  const exitCode = typeof execResult.status === "number" ? execResult.status : 1;
  const failuresAfterExec = [];
  const warningsAfterExec = [];

  if (timedOut) {
    failuresAfterExec.push(`codex exec timed out after ${options.timeoutSeconds}s.`);
  }

  if (exitCode !== 0) {
    failuresAfterExec.push(`codex exec exited with code ${exitCode}.`);
  }

  if (!preview.worktree.baseCommit) {
    failuresAfterExec.push("worktree registry missing baseCommit; committed branch scope check could not run.");
  }

  if (committedDiffError) {
    failuresAfterExec.push(committedDiffError.message);
  }

  failuresAfterExec.push(...outsideAllowedWarnings);
  failuresAfterExec.push(...forbiddenWarnings);

  if (!localReportExists) {
    failuresAfterExec.push(`worker output report missing: ${path.relative(preview.cwd, workerOutput.reportPath).replace(/\\/g, "/")}`);
  } else if (!reportExists) {
    failuresAfterExec.push(`report copy missing: ${relativeRunPath(runRoot, preview.reportPath)}`);
  }

  if (!localEventsExist) {
    warningsAfterExec.push(`worker output events missing: ${path.relative(preview.cwd, workerOutput.eventsPath).replace(/\\/g, "/")}`);
  }

  if (!lastMessageExists) {
    failuresAfterExec.push(`adapter output missing: ${relativeRunPath(runRoot, preview.outputLastMessagePath)}`);
  }

  const status = failuresAfterExec.length > 0 ? "FAIL" : "PASS";
  appendRunEvent(runRoot, "cli", {
    event: status === "PASS" ? "dispatch_exec_completed" : "dispatch_exec_failed",
    runId,
    adapter: "codex-exec",
    role: options.role,
    exitCode,
    status,
    taskId: preview.task.id,
    copiedReport: copiedOutput.report,
    copiedEvents: copiedOutput.events,
  });

  console.log("");
  console.log("CEWP Coordinator Mode codex-exec execution");
  console.log(`Run ID: ${runId}`);
  console.log(`Role: ${options.role}`);
  console.log("Adapter: codex-exec");
  console.log("");
  console.log(`Preflight: ${warnings.length > 0 ? "WARN" : "PASS"}`);
  console.log(`Execution: ${exitCode === 0 && !timedOut ? "PASS" : "FAIL"}`);
  console.log(`Exit code: ${exitCode}`);
  console.log(`Timeout: ${options.timeoutSeconds}s`);
  console.log("");
  console.log("Changed files:");
  if (changedFiles.length === 0) {
    console.log("  none");
  } else {
    for (const filePath of changedFiles) {
      console.log(`  ${filePath}${isWorkerRuntimeOutputPath(filePath) ? " (runtime output)" : ""}`);
    }
  }
  console.log("");
  console.log("Committed changes:");
  if (!preview.worktree.baseCommit) {
    console.log("  skipped: worktrees.json entry missing baseCommit");
  } else if (committedDiffError) {
    console.log(`  failed: ${committedDiffError.message}`);
  } else if (committedChangedFiles.length === 0) {
    console.log("  none");
  } else {
    for (const filePath of committedChangedFiles) {
      console.log(`  ${filePath}${isWorkerRuntimeOutputPath(filePath) ? " (runtime output)" : ""}`);
    }
  }
  console.log("");
  console.log("Runtime output:");
  if (runtimeOutputFiles.length === 0) {
    console.log("  none tracked by git status");
  } else {
    for (const filePath of runtimeOutputFiles) {
      console.log(`  ${filePath}`);
    }
  }
  console.log(`Worker report source: ${localReportExists ? path.relative(preview.cwd, workerOutput.reportPath).replace(/\\/g, "/") : "missing"}`);
  console.log(`Worker events source: ${localEventsExist ? path.relative(preview.cwd, workerOutput.eventsPath).replace(/\\/g, "/") : "missing"}`);
  console.log("");
  console.log(`Scope: ${outsideAllowedWarnings.length === 0 ? "OK" : "FAIL"}`);
  console.log(`Forbidden files: ${forbiddenWarnings.length === 0 ? "OK" : "FAIL"}`);
  console.log(`Report: ${reportExists ? `copied to ${relativeRunPath(runRoot, preview.reportPath)}` : `missing ${relativeRunPath(runRoot, preview.reportPath)}`}`);
  console.log(`Worker events: ${copiedOutput.events ? `appended to ${relativeRunPath(runRoot, preview.eventPath)}` : "not provided"}`);
  console.log(`Last message: ${lastMessageExists ? relativeRunPath(runRoot, preview.outputLastMessagePath) : "missing"}`);
  console.log(`Stdout log: ${relativeRunPath(runRoot, stdoutPath)}`);
  console.log(`Stderr log: ${relativeRunPath(runRoot, stderrPath)}`);
  console.log("");
  console.log(`Status: ${status}`);

  if (failuresAfterExec.length > 0) {
    console.log("Reasons:");
    for (const failure of failuresAfterExec) {
      console.log(`  - ${failure}`);
    }
  }

  if (warningsAfterExec.length > 0) {
    console.log("Warnings:");
    for (const warning of warningsAfterExec) {
      console.log(`  - ${warning}`);
    }
  }

  console.log("");
  console.log("No merge/push/publish was performed.");

  if (status === "FAIL") {
    process.exitCode = 1;
  }

  return status;
}

function getParallelWorkersPreflight(options = {}) {
  const roles = ["worker-a", "worker-b"];
  const failures = [];
  const warnings = [];
  const previews = [];

  for (const role of roles) {
    const result = getDispatchExecPreview({
      ...options,
      role,
      dryRun: true,
      printPreview: false,
    });
    previews.push({ role, result });

    for (const failure of result.failures) {
      failures.push(`${role}: ${failure}`);
    }
    for (const warning of result.warnings) {
      warnings.push(`${role}: ${warning}`);
    }
  }

  const workerA = previews.find((entry) => entry.role === "worker-a");
  const workerB = previews.find((entry) => entry.role === "worker-b");
  const previewA = workerA && workerA.result.preview;
  const previewB = workerB && workerB.result.preview;

  if (previewA && previewB) {
    if (previewA.cwd && previewB.cwd && normalizeComparePath(path.resolve(previewA.cwd)) === normalizeComparePath(path.resolve(previewB.cwd))) {
      failures.push(`worker-a and worker-b use the same worktree path: ${previewA.cwd}`);
    }

    const taskIdA = previewA.task && previewA.task.id;
    const taskIdB = previewB.task && previewB.task.id;
    if (taskIdA && taskIdB && taskIdA === taskIdB) {
      failures.push(`worker-a and worker-b are assigned the same task: ${taskIdA}`);
    }

    const allowedA = Array.isArray(previewA.task && previewA.task.allowedFiles) ? previewA.task.allowedFiles : [];
    const allowedB = Array.isArray(previewB.task && previewB.task.allowedFiles) ? previewB.task.allowedFiles : [];
    if (allowedA.length === 0) {
      failures.push("worker-a allowedFiles is empty; parallel execution requires explicit non-overlapping allowedFiles.");
    }
    if (allowedB.length === 0) {
      failures.push("worker-b allowedFiles is empty; parallel execution requires explicit non-overlapping allowedFiles.");
    }

    const overlap = getAllowedFilesOverlap(previewA.task || {}, previewB.task || {});
    if (overlap.length > 0) {
      failures.push(`worker allowedFiles overlap: ${overlap.join(", ")}`);
    }

    const forbiddenA = Array.isArray(previewA.task && previewA.task.forbiddenFiles) ? previewA.task.forbiddenFiles : [];
    const forbiddenB = Array.isArray(previewB.task && previewB.task.forbiddenFiles) ? previewB.task.forbiddenFiles : [];
    if (forbiddenA.length === 0) {
      failures.push("worker-a forbiddenFiles is empty; parallel execution requires forbiddenFiles.");
    }
    if (forbiddenB.length === 0) {
      failures.push("worker-b forbiddenFiles is empty; parallel execution requires forbiddenFiles.");
    }

    if (normalizeComparePath(path.resolve(previewA.reportPath)) === normalizeComparePath(path.resolve(previewB.reportPath))) {
      failures.push(`worker report output paths overlap: ${previewA.reportPath}`);
    }
    if (normalizeComparePath(path.resolve(previewA.eventPath)) === normalizeComparePath(path.resolve(previewB.eventPath))) {
      failures.push(`worker event output paths overlap: ${previewA.eventPath}`);
    }
    if (normalizeComparePath(path.resolve(previewA.outputLastMessagePath)) === normalizeComparePath(path.resolve(previewB.outputLastMessagePath))) {
      failures.push(`adapter output paths overlap: ${previewA.outputLastMessagePath}`);
    }
  }

  return {
    failures,
    warnings,
    previews,
  };
}

function printParallelWorkersPreflight(preflight) {
  console.log(`Parallel preflight: ${preflight.failures.length > 0 ? "FAIL" : preflight.warnings.length > 0 ? "WARN" : "PASS"}`);

  if (preflight.failures.length > 0) {
    console.log("Failures:");
    for (const failure of preflight.failures) {
      console.log(`  - ${failure}`);
    }
  }

  if (preflight.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of preflight.warnings) {
      console.log(`  - ${warning}`);
    }
  }
}

function buildWorkerChildArgs({ role, runId, options }) {
  const args = [
    __filename,
    "run",
    "dispatch",
    "exec",
    role,
    "--run",
    runId,
    "--adapter",
    "codex-exec",
    "--yes",
    "--timeout",
    String(options.timeoutSeconds || 120),
  ];
  return args;
}

function runWorkerChildProcess({ role, runId, options }) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, buildWorkerChildArgs({ role, runId, options }), {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        role,
        status: "FAIL",
        exitCode: 1,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
      });
    });

    child.on("close", (code) => {
      resolve({
        role,
        status: code === 0 ? "PASS" : "FAIL",
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

function runDispatchExecWorkersDryRun(options = {}) {
  const roles = ["worker-a", "worker-b"];
  let hasFailure = false;

  console.log("CEWP Coordinator Mode codex-exec workers dry-run");
  console.log(`Mode: ${options.parallel ? "parallel preview" : "sequential preview"}`);
  console.log("");

  if (options.parallel) {
    const preflight = getParallelWorkersPreflight(options);
    printParallelWorkersPreflight(preflight);
    if (preflight.failures.length > 0) {
      hasFailure = true;
    }
    console.log("");
  }

  console.log("Worker order:");
  console.log("  1. worker-a");
  console.log("  2. worker-b");
  console.log("");

  for (const role of roles) {
    const result = getDispatchExecPreview({ ...options, role, dryRun: true });
    if (result.failures.length > 0) {
      hasFailure = true;
    }
    console.log("");
  }

  console.log("No processes were started.");
  console.log("No files were changed.");

  if (hasFailure) {
    process.exitCode = 1;
  }

  return hasFailure ? "FAIL" : "PASS";
}

async function runDispatchExecWorkersParallelActual(options = {}) {
  if (!options.adapter) {
    throw new Error("dispatch exec requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }

  const { runId } = findRun(options);
  const preflight = getParallelWorkersPreflight(options);

  console.log("CEWP Coordinator Mode codex-exec workers execution");
  console.log(`Run ID: ${runId}`);
  console.log("Adapter: codex-exec");
  console.log("Mode: parallel");
  console.log("");
  printParallelWorkersPreflight(preflight);
  console.log("");

  if (preflight.failures.length > 0) {
    console.log("No worker processes were started.");
    console.log("No reviewer execution, merge, push, or publish was performed.");
    process.exitCode = 1;
    return {
      overall: "FAIL",
      results: [
        { role: "worker-a", status: "SKIPPED" },
        { role: "worker-b", status: "SKIPPED" },
      ],
    };
  }

  console.log("Worker mode:");
  console.log("  worker-a and worker-b start concurrently.");
  console.log("  Parallel mode is not fail-fast; both workers may finish even if one fails.");
  console.log("");

  const childResults = await Promise.all([
    runWorkerChildProcess({ role: "worker-a", runId, options }),
    runWorkerChildProcess({ role: "worker-b", runId, options }),
  ]);

  for (const result of childResults) {
    console.log(`--- ${result.role} output ---`);
    if (result.stdout.trim().length > 0) {
      process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
    }
    if (result.stderr.trim().length > 0) {
      process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
    }
  }

  const results = childResults.map((result) => ({ role: result.role, status: result.status }));
  const overall = results.every((result) => result.status === "PASS") ? "PASS" : "FAIL";

  console.log("");
  console.log("CEWP Coordinator Mode codex-exec workers summary");
  for (const result of results) {
    console.log(`${result.role}: ${result.status}`);
  }
  console.log("");
  console.log(`Overall: ${overall}`);

  if (overall === "PASS") {
    console.log("");
    console.log("Next:");
    console.log(`  cewp run collect --run ${runId}`);
    console.log(`  cewp run dispatch exec reviewer --run ${runId} --adapter codex-exec --yes`);
  } else {
    console.log("Reason: one or more parallel workers failed post-check");
    process.exitCode = 1;
  }

  console.log("");
  console.log("No reviewer execution, merge, push, or publish was performed.");

  return {
    overall,
    results,
  };
}

async function runDispatchExecWorkersActual(options = {}) {
  if (options.parallel) {
    return runDispatchExecWorkersParallelActual(options);
  }

  if (!options.adapter) {
    throw new Error("dispatch exec requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }

  const { runId } = findRun(options);
  const results = [];
  let overall = "PASS";

  console.log("CEWP Coordinator Mode codex-exec workers execution");
  console.log(`Run ID: ${runId}`);
  console.log("Adapter: codex-exec");
  console.log("Mode: sequential");
  console.log("");
  console.log("Worker order:");
  console.log("  1. worker-a");
  console.log("  2. worker-b");
  console.log("");

  for (const role of ["worker-a", "worker-b"]) {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const status = runDispatchExecActual({ ...options, role, yes: true, dryRun: false });
    results.push({ role, status: status || "FAIL" });

    if (status !== "PASS") {
      process.exitCode = 1;
      if (role === "worker-a") {
        results.push({ role: "worker-b", status: "SKIPPED" });
      }
      if (previousExitCode) {
        process.exitCode = previousExitCode;
      }
      overall = "FAIL";
      break;
    }
  }

  overall = results.some((result) => result.status === "FAIL") ? "FAIL" : overall;

  console.log("");
  console.log("CEWP Coordinator Mode codex-exec workers summary");
  for (const result of results) {
    console.log(`${result.role}: ${result.status}`);
  }
  console.log("");
  console.log(`Overall: ${overall}`);

  if (overall === "PASS") {
    console.log("");
    console.log("Next:");
    console.log(`  cewp run collect --run ${runId}`);
    console.log(`  cewp run dispatch exec reviewer --run ${runId} --adapter codex-exec --yes`);
  } else {
    const failed = results.find((result) => result.status === "FAIL");
    console.log(`Reason: ${failed ? `${failed.role} failed post-check` : "worker execution failed"}`);
    process.exitCode = 1;
  }

  console.log("");
  console.log("No reviewer execution, merge, push, or publish was performed.");

  return {
    overall,
    results,
  };
}

async function runDispatchExec(options = {}) {
  if (options.dryRun && options.yes) {
    throw new Error("Use either --dry-run or --yes, not both.");
  }

  if (!options.dryRun && !options.yes) {
    throw new Error("dispatch exec requires --dry-run or --yes.");
  }

  if (options.parallel && options.role !== "workers") {
    throw new Error("--parallel is only supported with dispatch exec workers.");
  }

  if (options.role === "workers") {
    if (options.dryRun) {
      runDispatchExecWorkersDryRun(options);
      return;
    }

    await runDispatchExecWorkersActual(options);
    return;
  }

  if (options.dryRun) {
    const result = getDispatchExecPreview(options);
    if (result.failures.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  runDispatchExecActual(options);
}

function validateCodexExecAdapter(options) {
  if (!options.adapter) {
    throw new Error("dispatch pipeline requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }
}

function runDispatchPipelineDryRun(options = {}) {
  validateCodexExecAdapter(options);

  const { runId, runRoot } = findRun(options);
  const dispatchPromptsRoot = path.join(runRoot, "dispatch-prompts");
  const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
  const promptCheckOptions = fs.existsSync(dispatchPromptsRoot)
    ? options
    : { ...options, ignoreMissingDispatchPrompts: true };

  console.log("CEWP Coordinator Mode dispatch pipeline");
  console.log(`Run ID: ${runId}`);
  console.log("Adapter: codex-exec");
  console.log(`Mode: dry-run ${options.parallel ? "parallel" : "sequential"} preview`);
  console.log("");

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const checkStatus = runDispatchCheck(promptCheckOptions);
  const checkFailed = process.exitCode === 1 || checkStatus === "FAIL";
  process.exitCode = previousExitCode;
  console.log("");

  console.log("Pipeline preview:");
  console.log(`  Step 1 dispatch check: ${checkStatus || "UNKNOWN"}`);
  console.log(`  Step 2 dispatch prompts: ${fs.existsSync(dispatchPromptsRoot) ? "would refresh existing prompt bundles" : "would create prompt bundles"}`);
  console.log(`  Step 3 workers: ${options.parallel ? "parallel" : "sequential"} preview follows`);
  const previewOptions = {
    ...options,
    ignoreMissingDispatchPrompts: true,
    ignoreMissingReviewInputs: true,
  };
  const workersPreviewStatus = runDispatchExecWorkersDryRun({ ...previewOptions, dryRun: true, role: "workers" });
  console.log(`  Step 4 collect: would write ${relativeRunPath(runRoot, reviewPacketPath)}`);
  console.log("  Step 5 reviewer: preview follows");
  const reviewerPreview = getDispatchExecPreview({ ...previewOptions, role: "reviewer", dryRun: true });
  console.log("");
  console.log("Overall dry-run:");
  console.log(checkFailed || workersPreviewStatus === "FAIL" || reviewerPreview.failures.length > 0 ? "  FAIL" : "  PASS");
  console.log("");
  console.log("No processes were started.");
  console.log("No files were changed.");

  if (checkFailed || workersPreviewStatus === "FAIL" || reviewerPreview.failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runDispatchPipelineActual(options = {}) {
  validateCodexExecAdapter(options);

  const { runId, runRoot } = findRun(options);
  const steps = [];
  let decision = "not found";
  let packetPath;
  const dispatchPromptsRoot = path.join(runRoot, "dispatch-prompts");
  const promptCheckOptions = fs.existsSync(dispatchPromptsRoot)
    ? options
    : { ...options, ignoreMissingDispatchPrompts: true };

  console.log("CEWP Coordinator Mode dispatch pipeline");
  console.log(`Run ID: ${runId}`);
  console.log("Adapter: codex-exec");
  console.log(`Mode: ${options.parallel ? "parallel" : "sequential"}`);
  console.log("");

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const checkStatus = runDispatchCheck(promptCheckOptions);
  const checkFailed = process.exitCode === 1 || checkStatus === "FAIL";
  process.exitCode = previousExitCode;
  steps.push({ name: "dispatch check", status: checkFailed ? "FAIL" : checkStatus });
  if (checkFailed) {
    printDispatchPipelineSummary({ runId, steps, decision, overall: "FAIL", reason: "dispatch check failed" });
    process.exitCode = 1;
    return;
  }

  let promptsResult;
  try {
    promptsResult = runDispatchPrompts(options);
    steps.push({ name: "dispatch prompts", status: "PASS" });
  } catch (error) {
    steps.push({ name: "dispatch prompts", status: "FAIL" });
    printDispatchPipelineSummary({ runId, steps, decision, overall: "FAIL", reason: error.message });
    process.exitCode = 1;
    return;
  }

  const workersResult = await runDispatchExecWorkersActual(options);
  steps.push({ name: "workers", status: workersResult.overall, details: workersResult.results });
  if (workersResult.overall !== "PASS") {
    printDispatchPipelineSummary({ runId, steps, decision, overall: "FAIL", reason: "workers failed" });
    process.exitCode = 1;
    return;
  }

  let collectResult;
  try {
    collectResult = runCollect(options);
    packetPath = collectResult.packetPath;
    steps.push({ name: "collect", status: "PASS" });
  } catch (error) {
    steps.push({ name: "collect", status: "FAIL" });
    printDispatchPipelineSummary({ runId, steps, decision, overall: "FAIL", reason: error.message });
    process.exitCode = 1;
    return;
  }

  const reviewerStatus = runDispatchReviewerExecActual(options, getDispatchExecPreview({ ...options, role: "reviewer", printPreview: false }));
  steps.push({ name: "reviewer", status: reviewerStatus });
  try {
    decision = findReviewerDecisionStrict(path.join(findRun(options).runRoot, "reviews", "reviewer-report.md")) || "not found";
  } catch {
    decision = "not found";
  }

  const overall = reviewerStatus === "PASS" ? "PASS" : "FAIL";
  printDispatchPipelineSummary({ runId, steps, decision, overall, packetPath });

  if (overall !== "PASS") {
    process.exitCode = 1;
  }
}

function printDispatchPipelineSummary({ runId, steps, decision, overall, reason, packetPath }) {
  console.log("");
  console.log("CEWP Coordinator Mode dispatch pipeline summary");
  steps.forEach((step, index) => {
    console.log(`Step ${index + 1}/${steps.length} ${step.name}: ${step.status}`);
    if (step.details) {
      for (const detail of step.details) {
        console.log(`  ${detail.role}: ${detail.status}`);
      }
    }
  });

  if (packetPath) {
    console.log(`Review packet: ${packetPath}`);
  }

  if (decision && decision !== "not found") {
    console.log(`Reviewer decision: ${decision}`);
  }

  console.log("");
  console.log(`Overall: ${overall}`);
  if (reason) {
    console.log(`Reason: ${reason}`);
  }

  if (overall === "PASS") {
    console.log("");
    console.log("Next:");
    console.log(`  cewp run finalize --run ${runId} --dry-run`);
    console.log(`  cewp run finalize --run ${runId}`);
  }

  console.log("");
  console.log("No finalize, cleanup, merge, push, or publish was performed.");
}

async function runDispatchPipeline(options = {}) {
  if (options.dryRun && options.yes) {
    throw new Error("Use either --dry-run or --yes, not both.");
  }

  if (!options.dryRun && !options.yes) {
    throw new Error("dispatch pipeline requires --dry-run or --yes.");
  }

  if (options.dryRun) {
    runDispatchPipelineDryRun(options);
    return;
  }

  await runDispatchPipelineActual(options);
}

function readWorktreesRegistry(runRoot) {
  const registryPath = path.join(runRoot, "worktrees.json");

  if (!fs.existsSync(registryPath)) {
    return undefined;
  }

  const registry = readJsonFile(registryPath, "worktrees registry");

  if (!Array.isArray(registry.worktrees)) {
    throw new Error(`Invalid worktrees registry: ${registryPath}. Missing worktrees array.`);
  }

  return registry;
}

function getTaskMap(runRoot) {
  return new Map(readTasks(runRoot).map(({ task }) => [task.id, task]));
}

function findReviewerDecisionStrict(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^\s*Decision\s*:\s*(PASS|REQUEST_CHANGES|BLOCK)\b/im);
  return match ? match[1] : undefined;
}
async function runCommand(options) {
  if (options.help || !options.subcommand) {
    usage();
    return;
  }

  if (options.subcommand === "init") {
    runInit(options);
    return;
  }

  if (options.subcommand === "status") {
    runStatus(options);
    return;
  }

  if (options.subcommand === "prompts") {
    runPrompts(options);
    return;
  }

  if (options.subcommand === "prompt") {
    runPrompt(options.role, options);
    return;
  }

  if (options.subcommand === "collect") {
    runCollect(options);
    return;
  }

  if (options.subcommand === "finalize") {
    runFinalize(options);
    return;
  }

  if (options.subcommand === "cleanup") {
    runCleanup(options);
    return;
  }

  if (options.subcommand === "prune") {
    runPrune(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "plan") {
    runWorktreesPlan(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "create") {
    runWorktreesCreate(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "status") {
    runWorktreesStatus(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "plan") {
    runDispatchPlan(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "check") {
    runDispatchCheck(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "prompts") {
    runDispatchPrompts(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "start") {
    runDispatchStart(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "exec") {
    await runDispatchExec(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "pipeline") {
    await runDispatchPipeline(options);
    return;
  }

  throw new Error(`Unsupported run command: ${options.subcommand}`);
}

async function main() {
  const rawArgs = process.argv.slice(2);

  try {
    const args = parseArgs(rawArgs);

    if (!args.command || args.help) {
      usage();
      return;
    }

    if (args.command === "init") {
      init(args);
      return;
    }

    if (args.command === "list") {
      list(args);
      return;
    }

    if (args.command === "doctor") {
      doctor(args);
      return;
    }

    if (args.command === "run") {
      await runCommand(args);
      return;
    }

    if (!["init", "list", "doctor", "run"].includes(args.command)) {
      throw new Error(`Unsupported command: ${args.command}`);
    }
  } catch (error) {
    printCliError(error, rawArgs);
    process.exitCode = 1;
  }
}

main();
