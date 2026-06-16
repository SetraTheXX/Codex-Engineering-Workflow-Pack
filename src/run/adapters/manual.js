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
const capabilities = {
  provider: MANUAL_ADAPTER,
  kind: "non-executing",
  executesExternalCommand: false,
  supportsDryRun: true,
  supportsManualHandoff: true,
  supportsResultIntake: true,
  requiresExternalBinary: false,
  requiresAuth: false,
  supportsLastMessage: true,
};

function getManualOutputRoot(runRoot) {
  return path.join(runRoot, "manual");
}

function getManualPromptPath(runRoot, role) {
  return path.join(getManualOutputRoot(runRoot), `${role}.md`);
}

function getManualResultOutputPath(runRoot, role) {
  if (role === "reviewer") {
    return path.join(runRoot, "reviews", "reviewer-report.md");
  }

  return path.join(runRoot, "reports", `${role}-report.md`);
}

function toRunRelative(runRoot, filePath) {
  return path.relative(runRoot, filePath).replace(/\\/g, "/");
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
  const runId = path.basename(runRoot);
  const manualPath = getManualPromptPath(runRoot, role);
  const resultOutputPath = getManualResultOutputPath(runRoot, role);
  const suggestedResultPath = path.join(getManualOutputRoot(runRoot), `${role}-result.md`);
  fs.mkdirSync(path.dirname(manualPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputLastMessagePath), { recursive: true });

  const content = [
    `# Manual Adapter Handoff: ${role}`,
    "",
    "## Summary",
    "",
    `Role: ${role}`,
    `Run ID: ${runId}`,
    `Run path: ${runRoot}`,
    `Working directory: ${worktreePath}`,
    "",
    "## Manual Action Required",
    "",
    MANUAL_ACTION_REASON,
    "The manual adapter did not execute code and did not call Codex or any external AI tool.",
    "External command: not executed",
    "",
    "## Complete The Manual Result",
    "",
    "1. Review the dispatch prompt below.",
    "2. Perform the requested work yourself in the indicated working directory.",
    "3. Save your completed result to a Markdown file.",
    "4. Record that result with CEWP so collect/review can continue.",
    "",
    `Suggested result file: ${toRunRelative(runRoot, suggestedResultPath)}`,
    `Expected CEWP output: ${toRunRelative(runRoot, resultOutputPath)}`,
    "",
    "```powershell",
    `cewp run dispatch complete ${role} --run ${runId} --from <file>`,
    "```",
    "",
    "The shorter form also works from the repo when this is the latest run:",
    "",
    "```powershell",
    `cewp run dispatch complete ${role} --from <file>`,
    "```",
    "",
    "## Paths",
    "",
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
  capabilities,
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
