"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findRun, appendRunEvent } = require("../runtime-cleanup");
const { getAdapterOutputPaths } = require("../adapters/codex-exec");
const { relativeRunPath } = require("./shared");

const COMPLETABLE_ROLES = ["worker-a", "worker-b", "reviewer"];

function assertCompletableRole(role) {
  if (!COMPLETABLE_ROLES.includes(role)) {
    throw new Error(`Unsupported manual completion role: ${role || "(missing)"}. Supported roles: ${COMPLETABLE_ROLES.join(", ")}.`);
  }
}

function getManualCompletionOutputPath(runRoot, role) {
  if (role === "reviewer") {
    return path.join(runRoot, "reviews", "reviewer-report.md");
  }

  return path.join(runRoot, "reports", `${role}-report.md`);
}

function runDispatchComplete(options = {}) {
  assertCompletableRole(options.role);

  if (!options.fromFile) {
    throw new Error("dispatch complete requires --from <file>.");
  }

  const sourcePath = path.resolve(process.cwd(), options.fromFile);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`manual completion source file missing: ${sourcePath}`);
  }

  const { runId, runRoot } = findRun(options);
  const resultText = fs.readFileSync(sourcePath, "utf8");
  const outputPath = getManualCompletionOutputPath(runRoot, options.role);
  const { adapterOutputRoot, outputLastMessagePath } = getAdapterOutputPaths(runRoot, options.role);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(adapterOutputRoot, { recursive: true });
  fs.writeFileSync(outputPath, resultText);
  fs.writeFileSync(
    outputLastMessagePath,
    [
      `Manual result recorded for ${options.role}.`,
      `Source: ${sourcePath}`,
      `Output: ${outputPath}`,
      "",
    ].join("\n"),
  );

  appendRunEvent(runRoot, options.role, {
    event: "manual_result_recorded",
    runId,
    sourcePath,
    outputPath,
    lastMessagePath: outputLastMessagePath,
  });

  console.log("Manual result recorded");
  console.log(`Run ID: ${runId}`);
  console.log(`Role: ${options.role}`);
  console.log(`Source: ${sourcePath}`);
  console.log(`Report: ${relativeRunPath(runRoot, outputPath)}`);
  console.log(`Last message: ${relativeRunPath(runRoot, outputLastMessagePath)}`);
  console.log("External command: not executed");
  console.log("No merge/push/publish was performed.");

  return {
    runId,
    role: options.role,
    sourcePath,
    outputPath,
    lastMessagePath: outputLastMessagePath,
  };
}

module.exports = {
  runDispatchComplete,
};
