#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const SKILLS = [
  "setup-codex-engineering-workflow",
  "diagnose",
  "tdd",
  "grill-with-docs",
  "to-prd",
  "to-issues",
  "handoff",
  "zoom-out",
  "prototype",
  "improve-codebase-architecture",
];

function usage() {
  console.log(`Codex Engineering Workflow Pack

Usage:
  cewp init [--mode repo|global] [--target <path>] [--force]
  cewp list [--mode repo|global] [--target <path>]
  cewp doctor [--mode repo|global] [--target <path>]
  cewp run init --workers <count> --reviewer
  cewp run status
  cewp run prompts
  cewp run prompt <manager|worker-a|worker-b|reviewer>
  cewp run worktrees plan
  cewp run worktrees create [--dry-run]
  cewp run worktrees status
  cewp run dispatch plan
  cewp run collect
  cewp run finalize [--dry-run]
  cewp run cleanup [--yes]
  cewp --help

Defaults:
  repo mode defaults to the current working directory when --target is omitted
  run commands default to the current working directory and latest run unless --run <id> is provided

Examples:
  cewp init
  cewp init --mode repo
  cewp init --mode repo --target "C:\\path\\to\\repo"
  cewp init --mode repo --target "/path/to/repo" --force
  cewp init --mode global
  cewp init --mode global --force
  cewp list
  cewp doctor --mode repo --target "/path/to/repo"
  cewp run init --workers 2 --reviewer
  cewp run status
  cewp run status --run 20260528-232250
  cewp run prompts
  cewp run prompt manager --run 20260528-232250
  cewp run worktrees plan --run 20260528-232250
  cewp run worktrees create --run 20260528-232250 --dry-run
  cewp run worktrees status --run 20260528-232250
  cewp run dispatch plan --run 20260528-232250
  cewp run collect --run 20260528-232250
  cewp run finalize --run 20260528-232250 --dry-run
  cewp run cleanup --run 20260528-232250
`);
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    subcommand: argv[1],
    role: argv[2],
    action: argv[2],
    runId: undefined,
    mode: "repo",
    target: undefined,
    targetProvided: false,
    force: false,
    help: false,
    dryRun: false,
    yes: false,
    workers: undefined,
    reviewer: false,
  };

  if (argv[0] === "--help" || argv[0] === "-h") {
    args.command = undefined;
    args.help = true;
    return args;
  }

  const optionStart = args.command === "run" ? 2 : 1;

  for (let index = optionStart; index < argv.length; index += 1) {
    const arg = argv[index];

    if (args.command === "run" && args.subcommand === "prompt" && index === 2) {
      args.role = arg;
      continue;
    }

    if (args.command === "run" && args.subcommand === "worktrees" && index === 2) {
      args.action = arg;
      continue;
    }

    if (args.command === "run" && args.subcommand === "dispatch" && index === 2) {
      args.action = arg;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--mode") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--mode requires repo or global.");
      }
      args.mode = value;
      index += 1;
      continue;
    }

    if (arg === "--target") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--target requires a path argument.");
      }
      args.target = value;
      args.targetProvided = true;
      index += 1;
      continue;
    }

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    if (args.command === "run" && arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (args.command === "run" && arg === "--yes") {
      args.yes = true;
      continue;
    }

    if (args.command === "run" && arg === "--workers") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("cewp run init --workers 2 --reviewer is the supported v0.2 shape.");
      }
      if (!/^\d+$/.test(value)) {
        throw new Error("cewp run init --workers 2 --reviewer is the supported v0.2 shape.");
      }
      args.workers = Number.parseInt(value, 10);
      index += 1;
      continue;
    }

    if (args.command === "run" && arg === "--reviewer") {
      args.reviewer = true;
      continue;
    }

    if (args.command === "run" && arg === "--run") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--run requires a run id.");
      }
      args.runId = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function formatRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function roleLabel(role) {
  if (role === "manager") {
    return "Manager";
  }

  if (role === "reviewer") {
    return "Reviewer";
  }

  const workerMatch = role.match(/^worker-([a-z])$/);
  if (workerMatch) {
    return `Worker ${workerMatch[1].toUpperCase()}`;
  }

  return role;
}

function getWorkerRoles(count) {
  if (count !== 2) {
    throw new Error("cewp run init --workers 2 --reviewer is the supported v0.2 shape.");
  }

  return Array.from({ length: count }, (_, index) => {
    const suffix = String.fromCharCode("a".charCodeAt(0) + index);
    return `worker-${suffix}`;
  });
}

function getRunRoot(runId, repoRoot = process.cwd()) {
  return path.join(path.resolve(repoRoot), ".cewp", "runs", runId);
}

function getRunsRoot(repoRoot = process.cwd()) {
  return path.join(path.resolve(repoRoot), ".cewp", "runs");
}

function validateRunId(runId) {
  if (!/^\d{8}-\d{6}$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}. Expected format: YYYYMMDD-HHMMSS.`);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(`${filePath}`, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listFiles(directory, extension) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => path.join(directory, name));
}

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

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${filePath}. ${error.message}`);
  }
}

function runGit(args, cwd) {
  return childProcess.spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
}

function getGitOutput(args, cwd) {
  const result = runGit(args, cwd);

  if (result.error) {
    throw new Error(`Failed to run git ${args.join(" ")}: ${result.error.message}`);
  }

  return result;
}

function isRepoDirty(repoRoot) {
  const result = getGitOutput(["status", "--porcelain"], repoRoot);

  if (result.status !== 0) {
    throw new Error(`Failed to inspect git status: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result.stdout.trim().length > 0;
}

function branchExists(repoRoot, branch) {
  const result = getGitOutput(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
  return result.status === 0;
}

function getGitStatusShort(worktreePath) {
  const result = getGitOutput(["status", "--short"], worktreePath);

  if (result.status !== 0) {
    throw new Error(`Failed to inspect git status for ${worktreePath}: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function getGitBranchName(worktreePath) {
  const result = getGitOutput(["branch", "--show-current"], worktreePath);

  if (result.status !== 0) {
    return "unknown";
  }

  return result.stdout.trim() || "detached";
}

function isGitWorktreePath(worktreePath) {
  if (!fs.existsSync(worktreePath) || !fs.statSync(worktreePath).isDirectory()) {
    return false;
  }

  const result = getGitOutput(["rev-parse", "--is-inside-work-tree"], worktreePath);
  return result.status === 0 && result.stdout.trim() === "true";
}

function getGitDiffStat(worktreePath) {
  const result = getGitOutput(["diff", "--stat"], worktreePath);

  if (result.status !== 0) {
    return "(failed to read git diff --stat)";
  }

  return result.stdout.trim() || "(no diff stat)";
}

function isPathUnderCewpWorktrees(worktreePath) {
  const normalized = path.resolve(worktreePath).replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/.cewp-worktrees/");
}

function removeGitWorktree(repoRoot, worktreePath) {
  const result = getGitOutput(["worktree", "remove", worktreePath], repoRoot);

  if (result.status !== 0) {
    throw new Error(`Failed to remove worktree ${worktreePath}: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function pruneGitWorktrees(repoRoot) {
  const result = getGitOutput(["worktree", "prune"], repoRoot);

  if (result.status !== 0) {
    throw new Error(`Failed to prune git worktrees: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function buildWorktreePlans(runId, runRoot) {
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const repoRoot = (runJson && runJson.repoRoot) || process.cwd();
  const taskEntries = readTasks(runRoot);

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

function appendRunEvent(runRoot, role, event) {
  const eventsRoot = path.join(runRoot, "events");
  fs.mkdirSync(eventsRoot, { recursive: true });
  fs.appendFileSync(
    path.join(eventsRoot, `${role}.jsonl`),
    `${JSON.stringify({ timestamp: new Date().toISOString(), role, ...event })}\n`,
  );
}

function makePlanTemplate(runId) {
  return `# CEWP Coordinator Run Plan

Run ID: ${runId}

## Goal

Describe the user goal for this coordinated run.

## Manager Plan

- Define isolated tasks.
- Assign each task to one worker.
- Keep board.json Manager/CLI-owned.
- Send completed worker output through the reviewer gate.

## Task Schema

\`\`\`json
{
  "schemaVersion": 1,
  "id": "task-001",
  "title": "Short task title",
  "status": "todo",
  "assignedRole": "worker-a",
  "dependsOn": [],
  "targetWorktree": "../.cewp-worktrees/<repo-name>/<run-id>/task-001",
  "branch": "cewp/task-001",
  "mission": "Precise implementation mission.",
  "allowedFiles": [],
  "forbiddenFiles": [".env", "config/api_keys.json"],
  "verification": [],
  "outputContract": {
    "summary": true,
    "changedFiles": true,
    "commandsRun": true,
    "tests": true,
    "risks": true,
    "handoff": true
  }
}
\`\`\`

Allowed task statuses: todo, claimed, in_progress, blocked, ready_for_review, review_failed, approved, merged, done.

## Worktree Guidance

v0.2 does not create worktrees automatically. Parallel workers must not edit the same working tree.

Recommended path:

\`\`\`txt
../.cewp-worktrees/<repo-name>/<run-id>/<task-id>/
\`\`\`
`;
}

function makeAgentFile(role, runId) {
  return `# ${roleLabel(role)}

Run ID: ${runId}
Role: ${role}

Use the matching prompt under prompts/ when starting this Codex session.
`;
}

function makeManagerPrompt({ runId, runRoot, repoRoot, workers }) {
  return `# CEWP Coordinator Mode - Manager Prompt

You are the Manager Codex for CEWP run ${runId}.

Repo root:
${repoRoot}

Run root:
${runRoot}

Your mission:
- Read the repo context and the user's goal.
- Produce a concise plan in plan.md.
- Split work into isolated task JSON files under tasks/.
- Update board.json as the Manager-owned coordination board.
- Define each task's allowedFiles and forbiddenFiles boundaries.
- Ask the Reviewer to gate worker output before any merge decision.

Hard rules:
- Do not edit production code.
- board.json may be written only by Manager/CLI.
- Workers may read board.json and tasks/*.json but must not write board.json.
- Do not merge.
- Do not push.
- Do not publish.
- Do not spawn Codex processes.
- Do not automate terminal input.
- Do not create worktrees automatically in v0.2.

Workers for this run:
${workers.map((worker) => `- ${worker}`).join("\n")}

Task schema to use:

\`\`\`json
{
  "schemaVersion": 1,
  "id": "task-001",
  "title": "Short task title",
  "status": "todo",
  "assignedRole": "worker-a",
  "dependsOn": [],
  "targetWorktree": "../.cewp-worktrees/<repo-name>/<run-id>/task-001",
  "branch": "cewp/task-001",
  "mission": "Precise implementation mission.",
  "allowedFiles": [],
  "forbiddenFiles": [".env", "config/api_keys.json"],
  "verification": [],
  "outputContract": {
    "summary": true,
    "changedFiles": true,
    "commandsRun": true,
    "tests": true,
    "risks": true,
    "handoff": true
  }
}
\`\`\`

Allowed task statuses:
todo, claimed, in_progress, blocked, ready_for_review, review_failed, approved, merged, done.

Worktree guidance:
- v0.2 only recommends worktree paths.
- Parallel workers must not work in the same working tree.
- Recommended path: ../.cewp-worktrees/<repo-name>/${runId}/<task-id>/
`;
}

function makeWorkerPrompt({ runId, runRoot, repoRoot, role }) {
  return `# CEWP Coordinator Mode - ${roleLabel(role)} Prompt

You are ${roleLabel(role)} for CEWP run ${runId}.

Repo root:
${repoRoot}

Run root:
${runRoot}

Your mission:
- Work only on the task assigned to ${role}.
- Read board.json and tasks/*.json.
- Follow the task mission, allowedFiles, forbiddenFiles, and verification list.
- Run verification commands when possible.
- Write your report to reports/${role}-report.md.
- Append your events to events/${role}.jsonl.

Hard rules:
- Do not write board.json.
- Do not edit tasks/*.json unless the Manager explicitly changes the run design.
- Do not work outside your assigned task.
- Do not edit files outside allowedFiles when allowedFiles is non-empty.
- Do not touch forbiddenFiles.
- Do not merge.
- Do not push.
- Do not publish.
- Do not spawn Codex processes.
- Do not automate terminal input.
- Do not work in the same working tree as another parallel worker.

Report template:

\`\`\`md
# Worker Report

Role: ${role}
Task:
Status:

## Summary

## Changed Files

## Commands Run

## Test Results

## Risks

## Handoff Notes
\`\`\`

Event JSONL guidance:
- Append one JSON object per line to events/${role}.jsonl.
- Include at least timestamp, role, event, and optional task id.
`;
}

function makeReviewerPrompt({ runId, runRoot, repoRoot }) {
  return `# CEWP Coordinator Mode - Reviewer Prompt

You are the Reviewer/Debugger Codex for CEWP run ${runId}.

Repo root:
${repoRoot}

Run root:
${runRoot}

Your mission:
- Review worker output without blindly trusting worker reports.
- Inspect changed files, diffs, test output, forbidden file touches, and scope creep.
- Read board.json, tasks/*.json, reports/*.md, and relevant git output.
- Write your review to reviews/reviewer-report.md.
- Append your events to events/reviewer.jsonl.

Hard rules:
- Do not implement production features.
- Do not write board.json.
- Do not write worker reports.
- Do not merge.
- Do not push.
- Do not publish.
- Do not spawn Codex processes.
- Do not automate terminal input.

Decision format:

\`\`\`md
# Reviewer Report

Decision: PASS | REQUEST_CHANGES | BLOCK

## Scope Check

## Forbidden File Check

## Diff Review

## Verification

## Required Changes

## Notes
\`\`\`
`;
}

function runInit(options) {
  if (options.subcommand !== "init") {
    throw new Error(`Unsupported run command: ${options.subcommand || "(missing)"}`);
  }

  const workers = getWorkerRoles(options.workers);

  if (!options.reviewer) {
    throw new Error("cewp run init currently requires --reviewer for v0.2.");
  }

  const repoRoot = path.resolve(process.cwd());
  const runId = formatRunId();
  const runRoot = getRunRoot(runId, repoRoot);

  if (fs.existsSync(runRoot)) {
    throw new Error(`Run already exists: ${runRoot}`);
  }

  const directories = [
    runRoot,
    path.join(runRoot, "events"),
    path.join(runRoot, "agents"),
    path.join(runRoot, "tasks"),
    path.join(runRoot, "reports"),
    path.join(runRoot, "reviews"),
    path.join(runRoot, "prompts"),
    path.join(runRoot, "handoff"),
  ];

  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const roles = ["manager", ...workers, "reviewer"];
  const runJson = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    repoRoot,
    workers,
    reviewer: "reviewer",
    status: "planning",
  };
  const boardJson = {
    schemaVersion: 1,
    runId,
    managerOwnsBoard: true,
    status: "planning",
    tasks: [],
    roles: Object.fromEntries(
      roles.map((role) => [role, { status: role === "manager" ? "active" : "waiting" }]),
    ),
  };

  writeJson(path.join(runRoot, "run.json"), runJson);
  writeJson(path.join(runRoot, "board.json"), boardJson);
  fs.writeFileSync(path.join(runRoot, "plan.md"), makePlanTemplate(runId));

  for (const role of roles) {
    fs.writeFileSync(path.join(runRoot, "agents", `${role}.md`), makeAgentFile(role, runId));
    fs.writeFileSync(path.join(runRoot, "events", `${role}.jsonl`), "");
  }

  fs.writeFileSync(
    path.join(runRoot, "prompts", "manager-prompt.md"),
    makeManagerPrompt({ runId, runRoot, repoRoot, workers }),
  );

  for (const role of workers) {
    fs.writeFileSync(
      path.join(runRoot, "prompts", `${role}-prompt.md`),
      makeWorkerPrompt({ runId, runRoot, repoRoot, role }),
    );
  }

  fs.writeFileSync(
    path.join(runRoot, "prompts", "reviewer-prompt.md"),
    makeReviewerPrompt({ runId, runRoot, repoRoot }),
  );

  console.log("CEWP Coordinator Mode run initialized");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log("");
  console.log("Next commands:");
  console.log("  cewp run prompts");
  console.log("  cewp run status");
}

function getTaskStatusCounts(tasks) {
  return tasks.reduce((counts, task) => {
    const status = task.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  return lines.map((line, index) => {
    const event = {
      order: index,
      lineOrder: index,
      filePath,
    };

    try {
      const parsed = JSON.parse(line);
      return {
        ...event,
        value: parsed,
        timeMs: getEventTimeMs(parsed),
      };
    } catch {
      return {
        ...event,
        value: line,
        timeMs: undefined,
      };
    }
  });
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

function getFileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function chooseLatestEvent(entries) {
  if (entries.length === 0) {
    return undefined;
  }

  return entries
    .map((entry, index) => ({
      ...entry,
      fallbackMs: getFileMtimeMs(entry.filePath),
      readOrder: index,
    }))
    .sort((left, right) => {
      const leftTime = left.event.timeMs;
      const rightTime = right.event.timeMs;

      if (leftTime !== undefined || rightTime !== undefined) {
        return (leftTime || 0) - (rightTime || 0);
      }

      if (left.fallbackMs !== right.fallbackMs) {
        return left.fallbackMs - right.fallbackMs;
      }

      if (left.lineOrder !== right.lineOrder) {
        return left.lineOrder - right.lineOrder;
      }

      return left.readOrder - right.readOrder;
    })
    .at(-1);
}

function runStatus(options = {}) {
  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskFiles = listFiles(path.join(runRoot, "tasks"), ".json");
  const tasks = taskFiles.map((filePath) => readJsonIfExists(filePath)).filter(Boolean);
  const reportFiles = listFiles(path.join(runRoot, "reports"), ".md");
  const reviewFiles = listFiles(path.join(runRoot, "reviews"), ".md");
  const eventFiles = listFiles(path.join(runRoot, "events"), ".jsonl");
  const statusCounts = getTaskStatusCounts(tasks);
  const lastEvents = eventFiles
    .flatMap((filePath) => readEvents(filePath).map((event) => ({ filePath, event })));
  const lastEvent = chooseLatestEvent(lastEvents);

  console.log("CEWP Coordinator Mode status");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Run status: ${(runJson && runJson.status) || "unknown"}`);
  console.log(`Board status: ${(boardJson && boardJson.status) || "unknown"}`);
  console.log("");
  console.log("Role status:");

  const roles = (boardJson && boardJson.roles) || {};
  for (const role of Object.keys(roles).sort()) {
    console.log(`  ${role}: ${roles[role].status || "unknown"}`);
  }

  if (Object.keys(roles).length === 0) {
    console.log("  none");
  }

  console.log("");
  console.log(`Tasks: ${tasks.length}`);

  if (Object.keys(statusCounts).length === 0) {
    console.log("  no task files found");
  } else {
    for (const status of Object.keys(statusCounts).sort()) {
      console.log(`  ${status}: ${statusCounts[status]}`);
    }
  }

  console.log("");
  console.log(`Reports: ${reportFiles.length ? reportFiles.map((filePath) => path.basename(filePath)).join(", ") : "none"}`);
  console.log(`Reviews: ${reviewFiles.length ? reviewFiles.map((filePath) => path.basename(filePath)).join(", ") : "none"}`);
  console.log("");

  if (lastEvent) {
    console.log(`Last event file: ${path.basename(lastEvent.filePath)}`);
    console.log(`Last event: ${typeof lastEvent.event.value === "string" ? lastEvent.event.value : JSON.stringify(lastEvent.event.value)}`);
  } else {
    console.log("Last event: none");
  }
}

function runPrompts(options = {}) {
  const { runId, runRoot } = findRun(options);
  const promptsRoot = path.join(runRoot, "prompts");

  console.log("CEWP Coordinator Mode prompts");
  console.log(`Run ID: ${runId}`);
  console.log("Paste each prompt into its matching Warp pane.");
  console.log("");
  console.log("Recommended Warp panes:");
  console.log("  Pane 1: Manager");
  console.log("  Pane 2: Worker A");
  console.log("  Pane 3: Worker B");
  console.log("  Pane 4: Reviewer");
  console.log("");
  console.log("Prompt commands:");
  console.log(`  manager  -> ${path.join(promptsRoot, "manager-prompt.md")}`);
  console.log("    cewp run prompt manager");
  console.log(`  worker-a -> ${path.join(promptsRoot, "worker-a-prompt.md")}`);
  console.log("    cewp run prompt worker-a");
  console.log(`  worker-b -> ${path.join(promptsRoot, "worker-b-prompt.md")}`);
  console.log("    cewp run prompt worker-b");
  console.log(`  reviewer -> ${path.join(promptsRoot, "reviewer-prompt.md")}`);
  console.log("    cewp run prompt reviewer");
}

function runPrompt(role, options = {}) {
  const supportedRoles = ["manager", "worker-a", "worker-b", "reviewer"];

  if (!supportedRoles.includes(role)) {
    throw new Error(`Unsupported run prompt role: ${role || "(missing)"}. Supported roles: ${supportedRoles.join(", ")}.`);
  }

  const { runRoot } = findRun(options);
  const promptFile = path.join(runRoot, "prompts", `${role}-prompt.md`);

  if (!fs.existsSync(promptFile)) {
    throw new Error(`Prompt file not found for ${role}: ${promptFile}`);
  }

  process.stdout.write(fs.readFileSync(promptFile, "utf8"));
}

function formatList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "none";
  }

  return value.join(", ");
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
    })),
  });
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

function parseChangedFile(statusLine) {
  const rawPath = statusLine.slice(3).trim();
  const renameParts = rawPath.split(" -> ");
  return renameParts[renameParts.length - 1].replace(/\\/g, "/");
}

function pathMatchesPattern(filePath, pattern) {
  const normalizedFile = filePath.replace(/\\/g, "/");
  const normalizedPattern = String(pattern).replace(/\\/g, "/");

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }

  return normalizedFile === normalizedPattern;
}

function findScopeWarnings(taskId, changedFiles, task) {
  const warnings = [];
  const allowedFiles = Array.isArray(task.allowedFiles) ? task.allowedFiles : [];
  const forbiddenFiles = Array.isArray(task.forbiddenFiles) ? task.forbiddenFiles : [];

  for (const filePath of changedFiles) {
    if (allowedFiles.length > 0 && !allowedFiles.some((pattern) => pathMatchesPattern(filePath, pattern))) {
      warnings.push(`${taskId} changed file outside allowedFiles: ${filePath}`);
    }

    if (forbiddenFiles.some((pattern) => pathMatchesPattern(filePath, pattern))) {
      warnings.push(`${taskId} changed forbidden file: ${filePath}`);
    }
  }

  return warnings;
}

function markdownList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "none";
  }

  return value.map((item) => `\`${item}\``).join(", ");
}

function getTaskStatusCountsFromTasks(tasks) {
  return tasks.reduce((counts, task) => {
    const status = task.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
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
    statusLines = getGitStatusShort(entry.path);
    diffStat = getGitDiffStat(entry.path);
    gitStatus = statusLines.length === 0 ? "clean" : "dirty";

    if (task) {
      warnings.push(...findScopeWarnings(taskId, statusLines.map(parseChangedFile), task));
    }
  }

  return {
    taskId,
    task,
    assignedRole,
    branch: entry.branch || "unknown",
    branchName,
    path: entry.path || "unknown",
    exists,
    isGitWorktree,
    gitStatus,
    statusLines,
    changedFiles: statusLines.map(parseChangedFile),
    diffStat,
    warnings,
  };
}

function getReportExcerpt(filePath, maxLines = 24) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const excerpt = lines.slice(0, maxLines).join("\n").trim();
  const suffix = lines.length > maxLines ? "\n\n...(truncated)" : "";
  return `${excerpt || "(empty report)"}${suffix}`;
}

function findReviewerDecision(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/\b(PASS|REQUEST_CHANGES|BLOCK)\b/);
  return match ? match[1] : "not found";
}

function findReviewerDecisionStrict(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^\s*Decision\s*:\s*(PASS|REQUEST_CHANGES|BLOCK)\b/im);
  return match ? match[1] : undefined;
}

function getLatestReviewerDecision(runRoot) {
  const reviewFiles = listFiles(path.join(runRoot, "reviews"), ".md");

  if (reviewFiles.length === 0) {
    throw new Error("Cannot finalize: no reviewer report found.");
  }

  const latestReviewFile = reviewFiles
    .map((filePath) => ({
      filePath,
      mtimeMs: getFileMtimeMs(filePath),
    }))
    .sort((left, right) => {
      if (left.mtimeMs !== right.mtimeMs) {
        return left.mtimeMs - right.mtimeMs;
      }

      return left.filePath.localeCompare(right.filePath);
    })
    .at(-1).filePath;
  const decision = findReviewerDecisionStrict(latestReviewFile);

  if (!decision) {
    throw new Error("Cannot finalize: reviewer decision not found.");
  }

  if (decision !== "PASS") {
    throw new Error(`Cannot finalize: reviewer decision is ${decision}.`);
  }

  return {
    decision,
    filePath: latestReviewFile,
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

function makeReviewPacket({
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
}) {
  const lines = [];
  const roleStatuses = (boardJson && boardJson.roles) || {};
  const statusCounts = getTaskStatusCountsFromTasks(tasks);

  lines.push("# CEWP Review Packet", "");

  lines.push("## Run Summary", "");
  lines.push(`- Run ID: ${runId}`);
  lines.push(`- Run status: ${(runJson && runJson.status) || "unknown"}`);
  lines.push(`- Board status: ${(boardJson && boardJson.status) || "unknown"}`);
  lines.push(`- Repo root: ${(runJson && runJson.repoRoot) || "unknown"}`);
  lines.push(`- Created at: ${(runJson && runJson.createdAt) || "unknown"}`);
  lines.push(`- Run root: ${runRoot}`, "");

  lines.push("## Board Summary", "");
  lines.push("Role statuses:");
  if (Object.keys(roleStatuses).length === 0) {
    lines.push("- none");
  } else {
    for (const role of Object.keys(roleStatuses).sort()) {
      lines.push(`- ${role}: ${roleStatuses[role].status || "unknown"}`);
    }
  }
  lines.push("");
  lines.push("Task status counts:");
  if (Object.keys(statusCounts).length === 0) {
    lines.push("- none");
  } else {
    for (const status of Object.keys(statusCounts).sort()) {
      lines.push(`- ${status}: ${statusCounts[status]}`);
    }
  }
  lines.push("");

  lines.push("## Tasks", "");
  if (tasks.length === 0) {
    lines.push("- No task files found.", "");
  } else {
    for (const task of tasks) {
      lines.push(`### ${task.id || "unknown-task"}`);
      lines.push(`- Title: ${task.title || "(untitled)"}`);
      lines.push(`- Assigned role: ${task.assignedRole || "unassigned"}`);
      lines.push(`- Status: ${task.status || "unknown"}`);
      lines.push(`- Branch: ${task.branch || "none"}`);
      lines.push(`- Target worktree: ${task.targetWorktree || "none"}`);
      lines.push(`- Allowed files: ${markdownList(task.allowedFiles)}`);
      lines.push(`- Forbidden files: ${markdownList(task.forbiddenFiles)}`);
      lines.push(`- Verification: ${markdownList(task.verification)}`);
      lines.push("");
    }
  }

  lines.push("## Worktrees", "");
  if (!registry) {
    lines.push("No worktrees.json found. Worktree diffs were not collected.", "");
  } else if (worktreeSnapshots.length === 0) {
    lines.push("No registered worktrees found.", "");
  } else {
    for (const snapshot of worktreeSnapshots) {
      lines.push(`### ${snapshot.taskId} / ${snapshot.assignedRole}`);
      lines.push(`- Branch: ${snapshot.branch}`);
      lines.push(`- Current branch: ${snapshot.branchName}`);
      lines.push(`- Path: ${snapshot.path}`);
      lines.push(`- Path exists: ${snapshot.exists ? "yes" : "no"}`);
      lines.push(`- Git worktree: ${snapshot.isGitWorktree ? "yes" : "no"}`);
      lines.push(`- Git status: ${snapshot.gitStatus}`);
      lines.push(`- Changed files: ${snapshot.changedFiles.length ? snapshot.changedFiles.join(", ") : "none"}`);
      lines.push("");
    }
  }

  lines.push("## Changed Files", "");
  if (worktreeSnapshots.length === 0) {
    lines.push("- none", "");
  } else {
    for (const snapshot of worktreeSnapshots) {
      lines.push(`### ${snapshot.taskId}`);
      if (snapshot.statusLines.length === 0) {
        lines.push("- Changed files: none");
      } else {
        lines.push("Changed files:");
        for (const line of snapshot.statusLines) {
          lines.push(`- ${line}`);
        }
      }
      lines.push("");
      lines.push("Diff stat:");
      lines.push("```txt");
      lines.push(snapshot.diffStat);
      lines.push("```", "");
    }
  }

  lines.push("## Scope Warnings", "");
  if (warnings.length === 0) {
    lines.push("- none", "");
  } else {
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Worker Reports", "");
  if (reportFiles.length === 0) {
    lines.push("- No worker report files found.", "");
  } else {
    for (const filePath of reportFiles) {
      lines.push(`### ${path.basename(filePath)}`);
      lines.push("```md");
      lines.push(getReportExcerpt(filePath));
      lines.push("```", "");
    }
  }

  lines.push("## Reviewer Reports", "");
  if (reviewFiles.length === 0) {
    lines.push("- No reviewer report files found.", "");
  } else {
    for (const filePath of reviewFiles) {
      lines.push(`- ${path.basename(filePath)}: decision ${findReviewerDecision(filePath)}`);
    }
    lines.push("");
  }

  lines.push("## Recent Events", "");
  if (recentEvents.length === 0) {
    lines.push("- none", "");
  } else {
    for (const event of recentEvents) {
      lines.push(`- ${event.file}: \`${JSON.stringify(event.value)}\``);
    }
    lines.push("");
  }

  lines.push("## Suggested Reviewer Checklist", "");
  lines.push("- Compare changed files against allowedFiles.");
  lines.push("- Check forbiddenFiles for every task.");
  lines.push("- Compare worker reports against actual git diff output.");
  lines.push("- Verify reported commands and test outputs.");
  lines.push("- Check docs/code consistency.");
  lines.push("- Decide: PASS / REQUEST_CHANGES / BLOCK.");
  lines.push("");

  lines.push("## Notes", "");
  lines.push("- This packet is generated by `cewp run collect`.");
  lines.push("- It does not merge, push, publish, mutate board/task JSON, create worktrees, or remove worktrees.");
  lines.push("");

  return `${lines.join("\n")}\n`;
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
}

function readRequiredJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }

  return readJsonFile(filePath, label);
}

function getFinalizeTaskUpdates(taskEntries) {
  return taskEntries.map(({ filePath, task }) => ({
    filePath,
    task,
    from: task.status || "unknown",
    to: "done",
  }));
}

function printFinalizePlan({ runId, runRoot, decisionInfo, runJson, boardJson, taskUpdates, dryRun }) {
  console.log("CEWP Coordinator Mode finalize");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "finalize"}`);
  console.log(`Reviewer decision: ${decisionInfo.decision}`);
  console.log(`Reviewer report: ${decisionInfo.filePath}`);
  console.log("");
  console.log("Planned state changes:");
  console.log(`  run.json: ${(runJson && runJson.status) || "unknown"} -> completed`);
  console.log(`  board.json: ${(boardJson && boardJson.status) || "unknown"} -> completed`);
  console.log("  roles:");

  const roles = (boardJson && boardJson.roles) || {};
  if (Object.keys(roles).length === 0) {
    console.log("    none");
  } else {
    for (const role of Object.keys(roles).sort()) {
      console.log(`    ${role}: ${(roles[role] && roles[role].status) || "unknown"} -> completed`);
    }
  }

  console.log("  tasks:");
  if (taskUpdates.length === 0) {
    console.log("    none");
  } else {
    for (const update of taskUpdates) {
      console.log(`    ${update.task.id || path.basename(update.filePath)}: ${update.from} -> ${update.to}`);
    }
  }
  console.log("  event: events/cli.jsonl");
  console.log("");
}

function runFinalize(options = {}) {
  const { runId, runRoot } = findRun(options);
  const decisionInfo = getLatestReviewerDecision(runRoot);
  const runJsonPath = path.join(runRoot, "run.json");
  const boardJsonPath = path.join(runRoot, "board.json");
  const runJson = readRequiredJson(runJsonPath, "run.json");
  const boardJson = readRequiredJson(boardJsonPath, "board.json");
  const taskEntries = readTasks(runRoot);
  const taskUpdates = getFinalizeTaskUpdates(taskEntries);

  printFinalizePlan({
    runId,
    runRoot,
    decisionInfo,
    runJson,
    boardJson,
    taskUpdates,
    dryRun: options.dryRun,
  });

  if (runJson.status === "completed" && boardJson.status === "completed") {
    console.log("Run is already completed. Finalize is idempotent.");
    if (options.dryRun) {
      console.log("Dry run only. No files were changed.");
    }
  }

  if (options.dryRun) {
    console.log("Dry run only. No files were changed.");
    console.log("No merge, push, publish, or cleanup was performed.");
    return;
  }

  runJson.status = "completed";
  boardJson.status = "completed";

  if (boardJson.roles && typeof boardJson.roles === "object") {
    for (const role of Object.keys(boardJson.roles)) {
      boardJson.roles[role] = {
        ...boardJson.roles[role],
        status: "completed",
      };
    }
  }

  writeJson(runJsonPath, runJson);
  writeJson(boardJsonPath, boardJson);

  for (const update of taskUpdates) {
    writeJson(update.filePath, {
      ...update.task,
      status: "done",
    });
  }

  appendRunEvent(runRoot, "cli", {
    event: "finalized",
    runId,
    decision: decisionInfo.decision,
    taskCount: taskUpdates.length,
  });

  console.log("Updated:");
  console.log("  run.json: completed");
  console.log("  board.json: completed");
  console.log(`  tasks: ${taskUpdates.length} done`);
  console.log("  event: events/cli.jsonl");
  console.log("");
  console.log("No merge, push, publish, or cleanup was performed.");
}

function getCleanupSnapshots(registry) {
  return registry.worktrees.map((entry) => {
    const exists = Boolean(entry.path && fs.existsSync(entry.path));
    const isDirectory = exists ? fs.statSync(entry.path).isDirectory() : false;
    const isGitWorktree = exists && isDirectory ? isGitWorktreePath(entry.path) : false;
    const safePath = Boolean(entry.path && isPathUnderCewpWorktrees(entry.path));
    const statusLines = exists && isGitWorktree ? getGitStatusShort(entry.path) : [];
    const dirty = statusLines.length > 0;
    let action = "would remove";
    let reason = "";

    if (!entry.path) {
      action = "skip";
      reason = "missing path";
    } else if (!safePath) {
      action = "warn";
      reason = "path outside .cewp-worktrees";
    } else if (!exists) {
      action = "skip";
      reason = "missing path";
    } else if (!isDirectory) {
      action = "warn";
      reason = "path is not a directory";
    } else if (!isGitWorktree) {
      action = "warn";
      reason = "path is not a git worktree";
    } else if (dirty) {
      action = "skip";
      reason = "dirty worktree";
    }

    return {
      entry,
      exists,
      isDirectory,
      isGitWorktree,
      safePath,
      statusLines,
      dirty,
      action,
      reason,
    };
  });
}

function printCleanupPlan({ runId, runRoot, snapshots, yes }) {
  console.log("CEWP Coordinator Mode cleanup");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Mode: ${yes ? "cleanup" : "dry-run"}`);
  console.log("");
  console.log(`Worktrees: ${snapshots.length}`);
  console.log("");

  for (const snapshot of snapshots) {
    const entry = snapshot.entry;
    const status = snapshot.exists
      ? snapshot.isGitWorktree
        ? snapshot.dirty ? "dirty" : "clean"
        : snapshot.isDirectory ? "not a git worktree" : "not a directory"
      : "missing";
    const action = snapshot.action === "would remove" && yes
      ? "remove"
      : snapshot.action === "would remove"
        ? "would remove"
        : `${snapshot.action} ${snapshot.reason}`.trim();

    console.log(`${entry.taskId || "unknown-task"}`);
    console.log(`  Branch: ${entry.branch || "unknown"}`);
    console.log(`  Path: ${entry.path || "unknown"}`);
    console.log(`  Exists: ${snapshot.exists ? "yes" : "no"}`);
    console.log(`  Git worktree: ${snapshot.isGitWorktree ? "yes" : "no"}`);
    console.log(`  Status: ${status}`);
    console.log(`  Action: ${action}`);
    console.log("");
  }

  if (!yes) {
    console.log("Run with --yes to remove clean registered worktrees.");
  }
}

function runCleanup(options = {}) {
  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const repoRoot = (runJson && runJson.repoRoot) || process.cwd();
  const registry = readWorktreesRegistry(runRoot);

  if (!registry) {
    console.log("No worktrees.json found. Nothing to clean up.");
    return;
  }

  const snapshots = getCleanupSnapshots(registry);
  const removable = snapshots.filter((snapshot) => (
    snapshot.safePath &&
    snapshot.exists &&
    snapshot.isGitWorktree &&
    !snapshot.dirty
  ));
  const skipped = snapshots.filter((snapshot) => !removable.includes(snapshot));

  printCleanupPlan({
    runId,
    runRoot,
    snapshots,
    yes: options.yes,
  });

  if (!options.yes) {
    appendRunEvent(runRoot, "cli", {
      event: "cleanup_dry_run",
      runId,
      removableCount: removable.length,
      skippedCount: skipped.length,
    });
    return;
  }

  const removed = [];
  const skippedMessages = [];

  for (const snapshot of snapshots) {
    if (removable.includes(snapshot)) {
      removeGitWorktree(repoRoot, snapshot.entry.path);
      removed.push(snapshot);
    } else {
      skippedMessages.push(`${snapshot.entry.taskId || "unknown-task"} -> ${snapshot.reason || "not removable"}`);
    }
  }

  pruneGitWorktrees(repoRoot);
  appendRunEvent(runRoot, "cli", {
    event: "cleanup_completed",
    runId,
    removedCount: removed.length,
    skippedCount: skippedMessages.length,
  });

  console.log("Removed:");
  if (removed.length === 0) {
    console.log("  none");
  } else {
    for (const snapshot of removed) {
      console.log(`  ${snapshot.entry.taskId || "unknown-task"} -> ${snapshot.entry.path}`);
    }
  }

  console.log("");
  console.log("Skipped:");
  if (skippedMessages.length === 0) {
    console.log("  none");
  } else {
    for (const message of skippedMessages) {
      console.log(`  ${message}`);
    }
  }

  console.log("");
  console.log("No merge, push, publish, or runtime history deletion was performed.");
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
    const statusLines = getGitStatusShort(entry.path);
    const changedFiles = statusLines.map(parseChangedFile);
    const scopeWarnings = task ? findScopeWarnings(taskId, changedFiles, task) : [];
    warnings.push(...scopeWarnings);

    console.log(`  Current branch: ${branchName}`);
    console.log(`  Git status: ${statusLines.length === 0 ? "clean" : "dirty"}`);

    if (statusLines.length === 0) {
      console.log("  Changed files: none");
    } else {
      console.log("  Changed files:");
      for (const line of statusLines) {
        console.log(`    ${line}`);
      }
    }

    console.log(`  Scope: ${scopeWarnings.length === 0 ? "OK" : "WARN"}`);
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
    })),
  });

  console.log(`Created worktree count: ${created.length}`);
  for (const plan of created) {
    console.log(`  ${plan.task.id}: created`);
    console.log(`    branch: ${plan.branch}`);
    console.log(`    path: ${plan.resolvedPath}`);
  }
  console.log("");
  console.log("Next:");
  console.log("  cewp run worktrees plan");
  console.log("  cewp run worktrees status");
}

function runCommand(options) {
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

  throw new Error(`Unsupported run command: ${options.subcommand}`);
}

function copySkill(sourceSkill, targetSkill, force) {
  if (fs.existsSync(targetSkill) && !force) {
    return "skipped";
  }

  fs.mkdirSync(targetSkill, { recursive: true });
  fs.cpSync(sourceSkill, targetSkill, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  return "copied";
}

function resolveTarget(options, { announceDefault = false } = {}) {
  if (options.mode !== "repo" && options.mode !== "global") {
    throw new Error("--mode must be repo or global.");
  }

  if (options.mode === "global" && options.target) {
    throw new Error("--target is only supported with --mode repo.");
  }

  const repoTarget = path.resolve(options.target || process.cwd());

  if (options.mode === "repo" && !options.targetProvided && announceDefault) {
    console.log(`No --target provided. Installing into current directory: ${repoTarget}`);
  }

  if (options.mode === "repo" && !fs.existsSync(repoTarget)) {
    throw new Error(`Target repo path does not exist: ${repoTarget}`);
  }

  return options.mode === "global"
    ? path.join(os.homedir(), ".agents", "skills")
    : path.join(repoTarget, ".agents", "skills");
}

function init(options) {
  const packageRoot = path.resolve(__dirname, "..");
  const sourceRoot = path.join(packageRoot, ".agents", "skills");

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source skills folder not found: ${sourceRoot}`);
  }

  const targetRoot = resolveTarget(options, { announceDefault: true });

  fs.mkdirSync(targetRoot, { recursive: true });

  const copied = [];
  const skipped = [];

  for (const skill of SKILLS) {
    const sourceSkill = path.join(sourceRoot, skill);
    const targetSkill = path.join(targetRoot, skill);

    if (!fs.existsSync(sourceSkill)) {
      console.warn(`Warning: missing source skill: ${skill}`);
      continue;
    }

    const result = copySkill(sourceSkill, targetSkill, options.force);
    if (result === "copied") {
      copied.push(skill);
      console.log(`Copied: ${skill}`);
    } else {
      skipped.push(skill);
      console.warn(`Skipping existing skill without --force: ${skill}`);
    }
  }

  console.log("");
  console.log("Install summary");
  console.log(`Mode: ${options.mode}`);
  console.log(`Source: ${sourceRoot}`);
  console.log(`Target: ${targetRoot}`);
  console.log(`Copied: ${copied.length ? copied.join(", ") : "none"}`);
  console.log(`Skipped: ${skipped.length ? skipped.join(", ") : "none"}`);
  console.log("");
  console.log("Restart or reload Codex so it can discover installed skills.");
}

function getSkillStatus(targetRoot) {
  return SKILLS.map((skill) => {
    const skillRoot = path.join(targetRoot, skill);
    const skillFile = path.join(skillRoot, "SKILL.md");
    return {
      skill,
      hasDirectory: fs.existsSync(skillRoot),
      hasSkillFile: fs.existsSync(skillFile),
    };
  });
}

function list(options) {
  const targetRoot = resolveTarget(options);
  const statuses = getSkillStatus(targetRoot);

  console.log(`Skills target: ${targetRoot}`);
  console.log("");

  for (const status of statuses) {
    const state = status.hasDirectory && status.hasSkillFile ? "OK" : "MISSING";
    console.log(`[${state}] ${status.skill}`);
  }
}

function doctor(options) {
  const targetRoot = resolveTarget(options);
  const statuses = getSkillStatus(targetRoot);
  const missing = statuses.filter((status) => !status.hasDirectory || !status.hasSkillFile);

  console.log("Codex Engineering Workflow Pack doctor");
  console.log(`Mode: ${options.mode}`);
  console.log(`Target: ${targetRoot}`);
  console.log("");

  if (!fs.existsSync(targetRoot)) {
    console.log("Status: FAIL");
    console.log("Reason: target skills directory does not exist.");
    console.log("");
    console.log("Run `cewp init` for repo install or `cewp init --mode global` for global install.");
    process.exitCode = 1;
    return;
  }

  for (const status of statuses) {
    const state = status.hasDirectory && status.hasSkillFile ? "OK" : "MISSING";
    console.log(`[${state}] ${status.skill}`);
  }

  console.log("");

  if (missing.length > 0) {
    console.log("Status: FAIL");
    console.log(`Missing or incomplete skills: ${missing.map((status) => status.skill).join(", ")}`);
    console.log("Run `cewp init --force` to reinstall missing skill files.");
    process.exitCode = 1;
    return;
  }

  console.log("Status: PASS");
  console.log("All 10 skills are installed with SKILL.md files.");
  console.log("Restart or reload Codex if newly installed skills are not visible.");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

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
      runCommand(args);
      return;
    }

    if (!["init", "list", "doctor", "run"].includes(args.command)) {
      throw new Error(`Unsupported command: ${args.command}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error("");
    usage();
    process.exitCode = 1;
  }
}

main();
