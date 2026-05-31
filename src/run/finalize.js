"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeJson, readRequiredJson } = require("../lib/json");
const { listFiles } = require("../lib/fs");
const { findRun, appendRunEvent } = require("./runtime-cleanup");
const { assertPolicyAllows } = require("./policy");

function getFileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
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

  if (!options.dryRun) {
    assertPolicyAllows(process.cwd(), "finalize");
  }

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

module.exports = {
  runFinalize,
};
