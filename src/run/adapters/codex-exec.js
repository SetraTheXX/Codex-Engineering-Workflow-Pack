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
  const invocation = buildCodexExecInvocation({
    command: "codex",
    prefixArgs: [],
    worktreePath: cwd,
    prompt: "$prompt",
    outputLastMessagePath: outputPath,
    sandbox,
  });

  console.log("PowerShell preview:");
  console.log(`  $prompt = Get-Content -Raw ${quote(promptPath)}`);
  console.log(`  ${invocation.command} exec --cd ${quote(cwd)} --sandbox ${sandbox} --output-last-message ${quote(outputPath)} $prompt`);
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

function getCodexExecCommand(env = process.env) {
  return env.CEWP_CODEX_EXEC_COMMAND || "codex";
}

function getCodexExecPrefixArgs(env = process.env) {
  const prefixArgs = env.CEWP_CODEX_EXEC_PREFIX_ARGS
    ? JSON.parse(env.CEWP_CODEX_EXEC_PREFIX_ARGS)
    : [];

  if (!Array.isArray(prefixArgs) || !prefixArgs.every((value) => typeof value === "string")) {
    throw new Error("CEWP_CODEX_EXEC_PREFIX_ARGS must be a JSON array of strings.");
  }

  return prefixArgs;
}

function checkCodexExecAvailability({ env = process.env, timeoutMs = 5000 } = {}) {
  let prefixArgs;
  try {
    prefixArgs = getCodexExecPrefixArgs(env);
  } catch (error) {
    return {
      adapter: "codex-exec",
      status: "FAIL",
      reason: error.message,
      command: getCodexExecCommand(env),
    };
  }

  const command = getCodexExecCommand(env);
  if (env.CEWP_CODEX_EXEC_COMMAND) {
    return {
      adapter: "codex-exec",
      status: "PASS",
      reason: "CEWP_CODEX_EXEC_COMMAND override is set; adapter command is managed by the caller.",
      command,
      prefixArgs,
      override: true,
    };
  }

  const result = childProcess.spawnSync(command, ["--version"], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error && result.error.code === "ENOENT") {
    return {
      adapter: "codex-exec",
      status: "FAIL",
      reason: "codex executable not found. Install Codex CLI or set CEWP_CODEX_EXEC_COMMAND.",
      command,
      prefixArgs,
    };
  }

  if (result.error) {
    return {
      adapter: "codex-exec",
      status: "FAIL",
      reason: `codex availability check failed: ${result.error.message}`,
      command,
      prefixArgs,
    };
  }

  if (result.status !== 0) {
    return {
      adapter: "codex-exec",
      status: "FAIL",
      reason: `codex --version exited with code ${typeof result.status === "number" ? result.status : 1}.`,
      command,
      prefixArgs,
    };
  }

  return {
    adapter: "codex-exec",
    status: "PASS",
    reason: "codex executable is available.",
    command,
    prefixArgs,
    version: String(result.stdout || result.stderr || "").trim(),
  };
}

function buildCodexExecInvocation({
  command,
  prefixArgs,
  worktreePath,
  prompt,
  outputLastMessagePath,
  sandbox = "workspace-write",
}) {
  return {
    command: command || "codex",
    args: [
    ...prefixArgs,
    "exec",
    "--cd",
    worktreePath,
    "--sandbox",
    sandbox,
    "--output-last-message",
    outputLastMessagePath,
    prompt,
    ],
    cwd: worktreePath,
  };
}

function runCodexExecAdapter({ worktreePath, promptPath, outputLastMessagePath, timeoutSeconds, sandbox = "workspace-write" }) {
  validateTimeoutSeconds(timeoutSeconds);
  const prompt = fs.readFileSync(promptPath, "utf8");
  const invocation = buildCodexExecInvocation({
    command: getCodexExecCommand(),
    prefixArgs: getCodexExecPrefixArgs(),
    worktreePath,
    prompt,
    outputLastMessagePath,
    sandbox,
  });

  return childProcess.spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
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
    adapter: "codex-exec",
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
  validateTimeoutSeconds,
  getAdapterOutputRoot,
  getAdapterOutputPaths,
  printCodexExecPreview,
  writeAdapterLog,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  getCodexExecCommand,
  getCodexExecPrefixArgs,
  checkAdapterAvailability: checkCodexExecAvailability,
  checkCodexExecAvailability,
  buildCodexExecInvocation,
  runCodexExecAdapter,
  getAdapterExitCode,
  didAdapterTimeOut,
  normalizeAdapterResult,
};
