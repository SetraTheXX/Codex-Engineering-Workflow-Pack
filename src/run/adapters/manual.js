"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  getAdapterOutputPaths,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  writeAdapterLog,
} = require("./codex-exec");

const MANUAL_ADAPTER = "manual";
const MANUAL_ACTION_REASON = "manual action required; adapter did not execute code.";

function getManualOutputRoot(runRoot) {
  return path.join(runRoot, "manual");
}

function getManualPromptPath(runRoot, role) {
  return path.join(getManualOutputRoot(runRoot), `${role}.md`);
}

function checkAdapterAvailability() {
  return {
    adapter: MANUAL_ADAPTER,
    status: "PASS",
    reason: "manual adapter writes handoff prompts and does not execute external commands.",
  };
}

function printCodexExecPreview({ runRoot, role, promptPath }) {
  console.log("Manual adapter preview:");
  console.log("  External command: not executed");
  console.log(`  Read prompt: ${promptPath}`);
  console.log(`  Manual handoff: ${path.relative(runRoot, getManualPromptPath(runRoot, role)).replace(/\\/g, "/")}`);
}

function runDispatchAdapter({ runRoot, role, worktreePath, promptPath, outputLastMessagePath }) {
  const prompt = fs.readFileSync(promptPath, "utf8");
  const manualPath = getManualPromptPath(runRoot, role);
  fs.mkdirSync(path.dirname(manualPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputLastMessagePath), { recursive: true });

  const content = [
    `# Manual Adapter Handoff: ${role}`,
    "",
    "The manual adapter did not execute code and did not call Codex or any external AI tool.",
    "",
    "Manual action is required:",
    "",
    "1. Review the dispatch prompt below.",
    "2. Perform the requested work yourself in the indicated working directory.",
    "3. Write the expected CEWP report and event outputs before continuing the workflow.",
    "",
    `Working directory: ${worktreePath}`,
    `Prompt source: ${promptPath}`,
    `Last-message marker: ${outputLastMessagePath}`,
    "",
    "## Dispatch Prompt",
    "",
    prompt,
    "",
  ].join("\n");

  fs.writeFileSync(manualPath, content);
  fs.writeFileSync(outputLastMessagePath, `${MANUAL_ACTION_REASON}\nManual handoff: ${manualPath}\n`);

  return {
    status: 1,
    stdout: `Manual handoff written: ${manualPath}\n${MANUAL_ACTION_REASON}\n`,
    stderr: "",
    manualPath,
    externalCommandExecuted: false,
  };
}

function getAdapterExitCode(execResult) {
  return typeof execResult.status === "number" ? execResult.status : 1;
}

function didAdapterTimeOut() {
  return false;
}

function formatExitReason() {
  return MANUAL_ACTION_REASON;
}

function normalizeAdapterResult({
  role,
  status,
  exitCode,
  timedOut,
  reason,
  reasons,
  paths,
  decision,
} = {}) {
  const normalizedReasons = Array.isArray(reasons)
    ? reasons.filter((value) => typeof value === "string" && value.length > 0)
    : [];
  const firstReason = reason || normalizedReasons[0];

  return {
    adapter: MANUAL_ADAPTER,
    role,
    status: status || (normalizedReasons.length > 0 ? "FAIL" : "PASS"),
    exitCode: typeof exitCode === "number" ? exitCode : undefined,
    timedOut: Boolean(timedOut),
    reason: firstReason,
    reasons: normalizedReasons,
    paths: paths || {},
    decision,
  };
}

module.exports = {
  MANUAL_ADAPTER,
  MANUAL_ACTION_REASON,
  executionName: "manual adapter",
  getAdapterOutputPaths,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  writeAdapterLog,
  checkAdapterAvailability,
  checkCodexExecAvailability: checkAdapterAvailability,
  printCodexExecPreview,
  runDispatchAdapter,
  getAdapterExitCode,
  didAdapterTimeOut,
  formatExitReason,
  normalizeAdapterResult,
};
