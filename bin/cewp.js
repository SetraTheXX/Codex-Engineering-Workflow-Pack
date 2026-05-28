#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
  cewp --help

Defaults:
  repo mode defaults to the current working directory when --target is omitted
  run commands default to the current working directory and latest run

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
  cewp run prompts
  cewp run prompt manager
`);
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    subcommand: argv[1],
    role: argv[2],
    mode: "repo",
    target: undefined,
    targetProvided: false,
    force: false,
    help: false,
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

function runStatus() {
  const { runId, runRoot } = findLatestRun();
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
  console.log(`Run status: ${(runJson && runJson.status) || (boardJson && boardJson.status) || "unknown"}`);
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

function runPrompts() {
  const { runId, runRoot } = findLatestRun();
  const promptsRoot = path.join(runRoot, "prompts");

  console.log("CEWP Coordinator Mode prompts");
  console.log(`Run ID: ${runId}`);
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

function runPrompt(role) {
  const supportedRoles = ["manager", "worker-a", "worker-b", "reviewer"];

  if (!supportedRoles.includes(role)) {
    throw new Error(`Unsupported run prompt role: ${role || "(missing)"}. Supported roles: ${supportedRoles.join(", ")}.`);
  }

  const { runRoot } = findLatestRun();
  const promptFile = path.join(runRoot, "prompts", `${role}-prompt.md`);

  if (!fs.existsSync(promptFile)) {
    throw new Error(`Prompt file not found for ${role}: ${promptFile}`);
  }

  process.stdout.write(fs.readFileSync(promptFile, "utf8"));
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
    runStatus();
    return;
  }

  if (options.subcommand === "prompts") {
    runPrompts();
    return;
  }

  if (options.subcommand === "prompt") {
    runPrompt(options.role);
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
