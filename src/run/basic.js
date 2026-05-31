"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeJson, readJsonIfExists } = require("../lib/json");
const { listFiles } = require("../lib/fs");
const { getRunRoot } = require("../lib/paths");
const { findRun } = require("./runtime-cleanup");
const {
  makePlanTemplate,
  makeAgentFile,
  makeManagerPrompt,
  makeWorkerPrompt,
  makeReviewerPrompt,
} = require("./templates/coordinator-prompts");

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

function getWorkerRoles(count) {
  if (count !== 2) {
    throw new Error("cewp run init --workers 2 --reviewer is the supported v0.2 shape.");
  }

  return Array.from({ length: count }, (_, index) => {
    const suffix = String.fromCharCode("a".charCodeAt(0) + index);
    return `worker-${suffix}`;
  });
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

module.exports = {
  runInit,
  runStatus,
  runPrompts,
  runPrompt,
};
