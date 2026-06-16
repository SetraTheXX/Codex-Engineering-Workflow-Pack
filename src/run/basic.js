"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeJson, readJsonIfExists } = require("../lib/json");
const { listFiles } = require("../lib/fs");
const { getRunRoot, getRunsRoot } = require("../lib/paths");
const { findRun } = require("./runtime-cleanup");
const {
  makePlanTemplate,
  makeAgentFile,
  makeManagerPrompt,
  makeWorkerPrompt,
  makeReviewerPrompt,
} = require("./templates/coordinator-prompts");

const OPERATOR_JSON_SCHEMA_VERSION = "operator-json/v1";

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

function inferRoleFromEventSource(source) {
  const basename = path.basename(source, ".jsonl");
  return ["manager", "worker-a", "worker-b", "reviewer"].includes(basename)
    ? basename
    : null;
}

function getEventField(value, fields) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return fields.find((field) => typeof value[field] === "string" && value[field].length > 0);
}

function getTimelineEventType(value) {
  const field = getEventField(value, ["type", "event", "name", "status"]);
  return field ? value[field] : "event";
}

function getTimelineEventSummary(value) {
  const field = getEventField(value, ["summary", "message", "reason", "status", "event", "type", "name"]);
  if (!field) {
    return null;
  }

  return value[field].length > 240 ? `${value[field].slice(0, 237)}...` : value[field];
}

function getTimelineEventTimestamp(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const timestamp = value.timestamp || value.time;
  return typeof timestamp === "string" && timestamp.length > 0 ? timestamp : null;
}

function buildTimelineRecord(runRoot, entry) {
  const source = toRunRelative(runRoot, entry.filePath);
  const line = entry.lineOrder + 1;

  if (!entry.value || typeof entry.value !== "object") {
    const summary = `Malformed event JSON at ${source}:${line}`;
    return {
      source,
      line,
      role: inferRoleFromEventSource(source),
      type: "malformed-event",
      timestamp: null,
      summary,
      malformed: true,
      raw: String(entry.value || "").slice(0, 500),
    };
  }

  return {
    source,
    line,
    role: typeof entry.value.role === "string" ? entry.value.role : inferRoleFromEventSource(source),
    type: getTimelineEventType(entry.value),
    timestamp: getTimelineEventTimestamp(entry.value),
    summary: getTimelineEventSummary(entry.value),
    malformed: false,
    raw: entry.value,
  };
}

function buildRunTimeline(runRoot, eventEntries) {
  const events = eventEntries
    .map(({ event }, readOrder) => ({
      ...buildTimelineRecord(runRoot, event),
      timeMs: event.timeMs,
      fallbackMs: getFileMtimeMs(event.filePath),
      readOrder,
    }))
    .sort((left, right) => {
      if (left.timeMs !== undefined || right.timeMs !== undefined) {
        return (left.timeMs || 0) - (right.timeMs || 0);
      }

      if (left.fallbackMs !== right.fallbackMs) {
        return left.fallbackMs - right.fallbackMs;
      }

      if (left.source !== right.source) {
        return left.source.localeCompare(right.source);
      }

      if (left.line !== right.line) {
        return left.line - right.line;
      }

      return left.readOrder - right.readOrder;
    })
    .map(({ timeMs, fallbackMs, readOrder, ...event }) => event);
  const warnings = events
    .filter((event) => event.malformed)
    .map((event) => ({
      source: event.source,
      line: event.line,
      message: event.summary,
    }));

  return {
    count: events.length,
    malformedCount: warnings.length,
    events,
    warnings,
  };
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

function toRunRelative(runRoot, filePath) {
  return path.relative(runRoot, filePath).replace(/\\/g, "/");
}

function formatFileList(runRoot, files) {
  if (files.length === 0) {
    return "none";
  }

  return files.map((filePath) => toRunRelative(runRoot, filePath)).join(", ");
}

function countEventLines(eventFiles) {
  return eventFiles.reduce((count, filePath) => {
    const lines = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return count + lines.length;
  }, 0);
}

function getArtifactRoles(boardJson) {
  const roles = Object.keys((boardJson && boardJson.roles) || {});
  const artifactRoles = roles.filter((role) => role.startsWith("worker-") || role === "reviewer");

  if (artifactRoles.length === 0) {
    return ["worker-a", "worker-b", "reviewer"];
  }

  return artifactRoles.sort();
}

function getExpectedReportPath(runRoot, role) {
  if (role === "reviewer") {
    return path.join(runRoot, "reviews", "reviewer-report.md");
  }

  return path.join(runRoot, "reports", `${role}-report.md`);
}

function getManualHandoffPath(runRoot, role) {
  return path.join(runRoot, "manual", `${role}.md`);
}

function getLastMessagePath(runRoot, role) {
  return path.join(runRoot, "adapter-output", `${role}-last-message.md`);
}

function getReviewerDecision(reviewFiles) {
  for (const filePath of reviewFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/^\s*Decision\s*:\s*(PASS|REQUEST_CHANGES|BLOCK)\b/im);

    if (match) {
      return {
        decision: match[1],
        filePath,
      };
    }
  }

  return undefined;
}

function getRecommendedActions({ runId, runRoot, artifactRoles, reportFiles, reviewFiles, reviewPacketFiles }) {
  const actions = [];
  const reportSet = new Set([...reportFiles, ...reviewFiles]);

  for (const role of artifactRoles) {
    const handoffPath = getManualHandoffPath(runRoot, role);
    const reportPath = getExpectedReportPath(runRoot, role);

    if (fs.existsSync(handoffPath) && !reportSet.has(reportPath)) {
      actions.push({
        command: `cewp run dispatch complete ${role} --run ${runId} --from <file>`,
        reason: `${role} has a manual handoff but its expected report is missing.`,
      });
    }
  }

  if (reportFiles.length > 0 && reviewPacketFiles.length === 0) {
    actions.push({
      command: `cewp run collect --run ${runId}`,
      reason: "Worker reports exist but no review packet has been collected.",
    });
  }

  if (reviewPacketFiles.length > 0 && reviewFiles.length === 0) {
    actions.push({
      command: `cewp run dispatch exec reviewer --run ${runId} --dry-run`,
      reason: "A review packet exists but no reviewer report is present.",
    });
  }

  const reviewerDecision = getReviewerDecision(reviewFiles);
  if (reviewerDecision && reviewerDecision.decision === "PASS") {
    actions.push({
      command: `cewp run finalize --run ${runId} --dry-run`,
      reason: `Reviewer report ${toRunRelative(runRoot, reviewerDecision.filePath)} contains Decision: PASS.`,
    });
  }

  return actions;
}

function getNextActionLabel(action) {
  if (!action) {
    return "none";
  }

  if (action.command.includes("dispatch complete")) {
    return "complete-manual";
  }

  if (action.command.includes("run collect")) {
    return "collect";
  }

  if (action.command.includes("exec reviewer")) {
    return "reviewer-dry-run";
  }

  if (action.command.includes("run finalize")) {
    return "finalize-dry-run";
  }

  return "inspect";
}

function inspectRun(options = {}) {
  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskFiles = listFiles(path.join(runRoot, "tasks"), ".json");
  const tasks = taskFiles.map((filePath) => readJsonIfExists(filePath)).filter(Boolean);
  const reportFiles = listFiles(path.join(runRoot, "reports"), ".md");
  const reviewFiles = listFiles(path.join(runRoot, "reviews"), ".md");
  const manualFiles = listFiles(path.join(runRoot, "manual"), ".md");
  const lastMessageFiles = listFiles(path.join(runRoot, "adapter-output"), "-last-message.md");
  const reviewPacketFiles = listFiles(path.join(runRoot, "review-packets"), ".md");
  const eventFiles = listFiles(path.join(runRoot, "events"), ".jsonl");
  const eventCount = countEventLines(eventFiles);
  const statusCounts = getTaskStatusCounts(tasks);
  const eventEntries = eventFiles
    .flatMap((filePath) => readEvents(filePath).map((event) => ({ filePath, event })));
  const lastEvent = chooseLatestEvent(eventEntries);
  const timeline = buildRunTimeline(runRoot, eventEntries);
  const artifactRoles = getArtifactRoles(boardJson);
  const recommendedActions = getRecommendedActions({
    runId,
    runRoot,
    artifactRoles,
    reportFiles,
    reviewFiles,
    reviewPacketFiles,
  });

  return {
    runId,
    runRoot,
    runJson,
    boardJson,
    tasks,
    reportFiles,
    reviewFiles,
    manualFiles,
    lastMessageFiles,
    reviewPacketFiles,
    eventFiles,
    eventCount,
    timeline,
    statusCounts,
    lastEvent,
    artifactRoles,
    recommendedActions,
  };
}

function formatStatusCounts(statusCounts) {
  const entries = Object.keys(statusCounts)
    .sort()
    .map((status) => `${status}:${statusCounts[status]}`);

  return entries.length === 0 ? "none" : entries.join(", ");
}

function formatRoleSummary(boardJson) {
  const roles = (boardJson && boardJson.roles) || {};
  const entries = Object.keys(roles)
    .sort()
    .map((role) => `${role}=${roles[role].status || "unknown"}`);

  return entries.length === 0 ? "none" : entries.join(", ");
}

function getRunDirectoryMtime(runRoot) {
  try {
    return fs.statSync(runRoot).mtime.toISOString();
  } catch {
    return "unknown";
  }
}

function getRunIds(repoRoot = process.cwd()) {
  const runsRoot = getRunsRoot(repoRoot);

  if (!fs.existsSync(runsRoot)) {
    return {
      runsRoot,
      runIds: [],
    };
  }

  const runIds = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{8}-\d{6}$/.test(name))
    .sort();

  return {
    runsRoot,
    runIds,
  };
}

function outputJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function getOperatorJsonWarnings(data) {
  if (data && data.timeline && Array.isArray(data.timeline.warnings)) {
    return data.timeline.warnings;
  }

  return [];
}

function makeOperatorJsonEnvelope(command, data, now = new Date()) {
  return {
    schemaVersion: OPERATOR_JSON_SCHEMA_VERSION,
    command,
    generatedAt: now.toISOString(),
    data,
    warnings: getOperatorJsonWarnings(data),
  };
}

function outputOperatorJson(command, data) {
  outputJson(makeOperatorJsonEnvelope(command, data));
}

function toRelativeFiles(runRoot, files) {
  return files.map((filePath) => toRunRelative(runRoot, filePath));
}

function getLatestRunId(repoRoot = process.cwd()) {
  const { runIds } = getRunIds(repoRoot);
  return runIds.length === 0 ? undefined : runIds[runIds.length - 1];
}

function getRoleStatusObject(boardJson) {
  const roles = (boardJson && boardJson.roles) || {};
  return Object.fromEntries(
    Object.keys(roles)
      .sort()
      .map((role) => [role, roles[role].status || "unknown"]),
  );
}

function getArtifactSummary(inspection) {
  return {
    manualHandoffs: {
      present: inspection.manualFiles.length > 0,
      count: inspection.manualFiles.length,
      files: toRelativeFiles(inspection.runRoot, inspection.manualFiles),
    },
    reports: {
      present: inspection.reportFiles.length > 0,
      count: inspection.reportFiles.length,
      files: toRelativeFiles(inspection.runRoot, inspection.reportFiles),
    },
    reviews: {
      present: inspection.reviewFiles.length > 0,
      count: inspection.reviewFiles.length,
      files: toRelativeFiles(inspection.runRoot, inspection.reviewFiles),
    },
    reviewPackets: {
      present: inspection.reviewPacketFiles.length > 0,
      count: inspection.reviewPacketFiles.length,
      files: toRelativeFiles(inspection.runRoot, inspection.reviewPacketFiles),
    },
    lastMessages: {
      present: inspection.lastMessageFiles.length > 0,
      count: inspection.lastMessageFiles.length,
      files: toRelativeFiles(inspection.runRoot, inspection.lastMessageFiles),
    },
    events: {
      fileCount: inspection.eventFiles.length,
      count: inspection.eventCount,
      files: toRelativeFiles(inspection.runRoot, inspection.eventFiles),
    },
  };
}

function serializeAction(action) {
  if (!action) {
    return null;
  }

  return {
    label: getNextActionLabel(action),
    command: action.command,
    reason: action.reason,
  };
}

function serializeRunInspection(inspection, { command, latestRunId, includeTimeline = false } = {}) {
  const reviewerDecision = getReviewerDecision(inspection.reviewFiles);

  const serialized = {
    command,
    runId: inspection.runId,
    runPath: inspection.runRoot,
    latest: Boolean(latestRunId && inspection.runId === latestRunId),
    createdAt: (inspection.runJson && inspection.runJson.createdAt) || null,
    modifiedAt: getRunDirectoryMtime(inspection.runRoot),
    state: {
      run: (inspection.runJson && inspection.runJson.status) || "unknown",
      board: (inspection.boardJson && inspection.boardJson.status) || "unknown",
    },
    roles: getRoleStatusObject(inspection.boardJson),
    tasks: {
      count: inspection.tasks.length,
      statusCounts: Object.fromEntries(
        Object.keys(inspection.statusCounts)
          .sort()
          .map((status) => [status, inspection.statusCounts[status]]),
      ),
    },
    artifacts: getArtifactSummary(inspection),
    reviewer: {
      reportPresent: inspection.reviewFiles.length > 0,
      decision: reviewerDecision ? reviewerDecision.decision : null,
      pass: Boolean(reviewerDecision && reviewerDecision.decision === "PASS"),
    },
    nextAction: serializeAction(inspection.recommendedActions[0]),
    nextActions: inspection.recommendedActions.map(serializeAction),
  };

  if (includeTimeline) {
    serialized.timeline = inspection.timeline;
  }

  return serialized;
}

function runStatus(options = {}) {
  const inspection = inspectRun(options);
  const {
    runId,
    runRoot,
    runJson,
    boardJson,
    tasks,
    reportFiles,
    reviewFiles,
    manualFiles,
    lastMessageFiles,
    reviewPacketFiles,
    eventFiles,
    eventCount,
    statusCounts,
    lastEvent,
    artifactRoles,
    recommendedActions,
  } = inspection;

  if (options.json) {
    outputOperatorJson("run status", serializeRunInspection(inspection, {
      command: "run status",
      latestRunId: getLatestRunId(),
      includeTimeline: true,
    }));
    return;
  }

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
  console.log("Artifacts:");
  for (const role of artifactRoles) {
    const reportPath = getExpectedReportPath(runRoot, role);
    const handoffPath = getManualHandoffPath(runRoot, role);
    const lastMessagePath = getLastMessagePath(runRoot, role);

    console.log(`  ${role}:`);
    console.log(`    report: ${fs.existsSync(reportPath) ? toRunRelative(runRoot, reportPath) : "missing"}`);
    console.log(`    manual handoff: ${fs.existsSync(handoffPath) ? toRunRelative(runRoot, handoffPath) : "missing"}`);
    console.log(`    last message: ${fs.existsSync(lastMessagePath) ? toRunRelative(runRoot, lastMessagePath) : "missing"}`);
  }

  console.log("");
  console.log("Artifact inventory:");
  console.log(`  Reports: ${formatFileList(runRoot, reportFiles)}`);
  console.log(`  Reviews: ${formatFileList(runRoot, reviewFiles)}`);
  console.log(`  Manual handoffs: ${formatFileList(runRoot, manualFiles)}`);
  console.log(`  Last-message markers: ${formatFileList(runRoot, lastMessageFiles)}`);
  console.log(`  Review packets: ${formatFileList(runRoot, reviewPacketFiles)}`);
  console.log(`  Event files: ${eventFiles.length}`);
  console.log(`  Events: ${eventCount}`);
  console.log("");

  if (lastEvent) {
    console.log(`Last event file: ${path.basename(lastEvent.filePath)}`);
    console.log(`Last event: ${typeof lastEvent.event.value === "string" ? lastEvent.event.value : JSON.stringify(lastEvent.event.value)}`);
  } else {
    console.log("Last event: none");
  }

  console.log("");
  console.log("Next suggested actions:");
  if (recommendedActions.length === 0) {
    console.log("  No safe next action found. Inspect run artifacts before proceeding.");
  } else {
    for (const action of recommendedActions) {
      console.log(`  ${action.command}`);
    }
  }
}

function runList(options = {}) {
  const repoRoot = path.resolve(process.cwd());
  const { runsRoot, runIds } = getRunIds(repoRoot);
  const limit = options.limit || 10;

  if (options.json) {
    const latestRunId = runIds.length === 0 ? undefined : runIds[runIds.length - 1];
    const recentRunIds = runIds.slice(-limit).reverse();
    outputOperatorJson("run list", {
      command: "run list",
      runsRoot,
      limit,
      latestRunId: latestRunId || null,
      runs: recentRunIds.map((runId) => serializeRunInspection(inspectRun({ runId }), {
        command: "run list",
        latestRunId,
      })),
    });
    return;
  }

  console.log("CEWP Coordinator Mode run list");
  console.log(`Runs root: ${runsRoot}`);
  console.log(`Limit: ${limit}`);

  if (runIds.length === 0) {
    console.log("No CEWP runs found.");
    return;
  }

  const latestRunId = runIds[runIds.length - 1];
  const recentRunIds = runIds.slice(-limit).reverse();

  console.log("");
  console.log("Recent runs:");

  for (const runId of recentRunIds) {
    const inspection = inspectRun({ runId });
    const action = inspection.recommendedActions[0];
    const reviewerDecision = getReviewerDecision(inspection.reviewFiles);

    console.log(`  ${runId}${runId === latestRunId ? " (latest)" : ""}`);
    console.log(`    created: ${(inspection.runJson && inspection.runJson.createdAt) || "unknown"}`);
    console.log(`    modified: ${getRunDirectoryMtime(inspection.runRoot)}`);
    console.log(`    state: run=${(inspection.runJson && inspection.runJson.status) || "unknown"}, board=${(inspection.boardJson && inspection.boardJson.status) || "unknown"}`);
    console.log(`    roles: ${formatRoleSummary(inspection.boardJson)}`);
    console.log(`    tasks: ${inspection.tasks.length} (${formatStatusCounts(inspection.statusCounts)})`);
    console.log(`    manual handoff: ${inspection.manualFiles.length > 0 ? "yes" : "no"}`);
    console.log(`    worker reports: ${inspection.reportFiles.length > 0 ? "yes" : "no"} (${inspection.reportFiles.length})`);
    console.log(`    review packet: ${inspection.reviewPacketFiles.length > 0 ? "yes" : "no"}`);
    console.log(`    reviewer report: ${inspection.reviewFiles.length > 0 ? "yes" : "no"}`);
    console.log(`    reviewer PASS: ${reviewerDecision && reviewerDecision.decision === "PASS" ? "yes" : "no"}`);
    console.log(`    next: ${getNextActionLabel(action)}`);
  }
}

function runNext(options = {}) {
  const inspection = inspectRun(options);
  const {
    runId,
    runRoot,
    runJson,
    boardJson,
    reportFiles,
    reviewFiles,
    manualFiles,
    reviewPacketFiles,
    recommendedActions,
  } = inspection;
  const action = recommendedActions[0];

  if (options.json) {
    const serialized = serializeRunInspection(inspection, {
      command: "run next",
      latestRunId: getLatestRunId(),
    });
    outputOperatorJson("run next", {
      command: "run next",
      runId: serialized.runId,
      runPath: serialized.runPath,
      latest: serialized.latest,
      state: serialized.state,
      artifacts: serialized.artifacts,
      reviewer: serialized.reviewer,
      nextAction: serialized.nextAction,
    });
    return;
  }

  console.log("CEWP Coordinator Mode next");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Current state: run=${(runJson && runJson.status) || "unknown"}, board=${(boardJson && boardJson.status) || "unknown"}, reports=${reportFiles.length}, reviews=${reviewFiles.length}, review-packets=${reviewPacketFiles.length}, manual-handoffs=${manualFiles.length}`);
  console.log("");

  if (!action) {
    console.log("Recommended command: none");
    console.log("Reason: no safe next action found.");
    return;
  }

  console.log(`Recommended command: ${action.command}`);
  console.log(`Reason: ${action.reason}`);
}

function getResumeSummary(serialized) {
  const manualCompletionCommands = serialized.nextActions
    .filter((action) => action.label === "complete-manual")
    .map((action) => action.command);

  return {
    recommendedCommand: serialized.nextAction ? serialized.nextAction.command : null,
    reason: serialized.nextAction ? serialized.nextAction.reason : "no safe next action found.",
    manualCompletionCommands,
    followUpCommands: [
      `cewp run status ${serialized.runId}`,
      `cewp run next ${serialized.runId}`,
      "cewp run list",
    ],
  };
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function runResume(options = {}) {
  const inspection = inspectRun(options);
  const serialized = serializeRunInspection(inspection, {
    command: "run resume",
    latestRunId: getLatestRunId(),
    includeTimeline: true,
  });
  const resume = getResumeSummary(serialized);

  if (options.json) {
    outputOperatorJson("run resume", {
      ...serialized,
      resume,
    });
    return;
  }

  console.log("# CEWP Run Resume");
  console.log("");
  console.log(`Run ID: ${serialized.runId}`);
  console.log(`Run path: ${serialized.runPath}`);
  console.log(`Latest: ${yesNo(serialized.latest)}`);
  console.log("");
  console.log("## Current State");
  console.log(`- Run: ${serialized.state.run}`);
  console.log(`- Board: ${serialized.state.board}`);
  console.log(`- Tasks: ${serialized.tasks.count} (${formatStatusCounts(inspection.statusCounts)})`);
  console.log(`- Roles: ${formatRoleSummary(inspection.boardJson)}`);
  console.log("");
  console.log("## Artifacts");
  console.log(`- Manual handoffs: ${yesNo(serialized.artifacts.manualHandoffs.present)} (${serialized.artifacts.manualHandoffs.count})`);
  console.log(`- Worker reports: ${yesNo(serialized.artifacts.reports.present)} (${serialized.artifacts.reports.count})`);
  console.log(`- Review packets: ${yesNo(serialized.artifacts.reviewPackets.present)} (${serialized.artifacts.reviewPackets.count})`);
  console.log(`- Reviewer report: ${yesNo(serialized.reviewer.reportPresent)}`);
  console.log(`- Reviewer decision: ${serialized.reviewer.decision || "none"}`);
  console.log(`- Reviewer PASS: ${yesNo(serialized.reviewer.pass)}`);
  console.log("");
  console.log("## Recommended Next Action");
  console.log(`- Command: ${resume.recommendedCommand || "none"}`);
  console.log(`- Reason: ${resume.reason}`);

  if (resume.manualCompletionCommands.length > 0) {
    console.log("");
    console.log("## Manual Completion");
    for (const command of resume.manualCompletionCommands) {
      console.log(`- ${command}`);
    }
  }

  console.log("");
  console.log("## Useful Follow-Up Commands");
  for (const command of resume.followUpCommands) {
    console.log(`- ${command}`);
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
  runList,
  runStatus,
  runNext,
  runResume,
  runPrompts,
  runPrompt,
};
