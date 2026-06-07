"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function validateTimeoutSeconds(timeoutSeconds) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("--timeout requires a positive number of seconds.");
  }

  return timeoutSeconds;
}

function getAdapterOutputRoot(runRoot) {
  return path.join(runRoot, "adapter-output");
}

function getAdapterOutputPaths(runRoot, role) {
  const adapterOutputRoot = getAdapterOutputRoot(runRoot);
  return {
    adapterOutputRoot,
    outputLastMessagePath: path.join(adapterOutputRoot, `${role}-last-message.md`),
    stdoutPath: path.join(adapterOutputRoot, `${role}-stdout.log`),
    stderrPath: path.join(adapterOutputRoot, `${role}-stderr.log`),
  };
}

function printCodexExecPreview({ cwd, promptPath, outputPath, sandbox }) {
  console.log("PowerShell preview:");
  console.log(`  $prompt = Get-Content -Raw ${quote(promptPath)}`);
  console.log(`  codex exec --cd ${quote(cwd)} --sandbox ${sandbox} --output-last-message ${quote(outputPath)} $prompt`);
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

function runCodexExecAdapter({ worktreePath, promptPath, outputLastMessagePath, timeoutSeconds, sandbox = "workspace-write" }) {
  validateTimeoutSeconds(timeoutSeconds);
  const prompt = fs.readFileSync(promptPath, "utf8");
  const command = process.env.CEWP_CODEX_EXEC_COMMAND || "codex";
  const prefixArgs = process.env.CEWP_CODEX_EXEC_PREFIX_ARGS
    ? JSON.parse(process.env.CEWP_CODEX_EXEC_PREFIX_ARGS)
    : [];

  if (!Array.isArray(prefixArgs) || !prefixArgs.every((value) => typeof value === "string")) {
    throw new Error("CEWP_CODEX_EXEC_PREFIX_ARGS must be a JSON array of strings.");
  }

  return childProcess.spawnSync(command, [
    ...prefixArgs,
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

function getAdapterExitCode(execResult) {
  return typeof execResult.status === "number" ? execResult.status : 1;
}

function didAdapterTimeOut(execResult) {
  return Boolean(execResult.error && execResult.error.code === "ETIMEDOUT");
}

module.exports = {
  validateTimeoutSeconds,
  getAdapterOutputRoot,
  getAdapterOutputPaths,
  printCodexExecPreview,
  writeAdapterLog,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  runCodexExecAdapter,
  getAdapterExitCode,
  didAdapterTimeOut,
};
