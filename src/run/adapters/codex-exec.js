"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { probeAdapterCli } = require("./cli-probe");
const { normalizeLegacyAvailability } = require("./availability");
const { normalizeAdapterResult: normalizeAdapterResultBase } = require("./result");

const capabilities = {
  provider: "codex-exec",
  kind: "executing",
  executesExternalCommand: true,
  supportsDryRun: true,
  supportsManualHandoff: false,
  supportsResultIntake: false,
  requiresExternalBinary: true,
  requiresAuth: false,
  supportsLastMessage: true,
};

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

  return {
    ...probeAdapterCli({
      provider: "codex-exec",
      binary: "codex",
      envOverride: "CEWP_CODEX_EXEC_COMMAND",
      versionArgs: ["--version"],
      env,
      timeoutMs,
      missingReason: "codex executable not found. Install Codex CLI or set CEWP_CODEX_EXEC_COMMAND.",
      availableReason: ({ override }) => (
        override
          ? "CEWP_CODEX_EXEC_COMMAND override is set; adapter command is managed by the caller."
          : "codex executable is available."
      ),
    }),
    prefixArgs,
  };
}

function getCodexExecAvailabilityRemediation(availability) {
  if (availability.status === "PASS") {
    return null;
  }

  if (availability.reason && availability.reason.includes("CEWP_CODEX_EXEC_PREFIX_ARGS")) {
    return "Set CEWP_CODEX_EXEC_PREFIX_ARGS to a JSON array of strings.";
  }

  if (availability.reason && availability.reason.includes("codex executable not found")) {
    return "Install Codex CLI or set CEWP_CODEX_EXEC_COMMAND.";
  }

  return "Check the codex executable and CEWP_CODEX_EXEC_COMMAND/CEWP_CODEX_EXEC_PREFIX_ARGS environment.";
}

function getAdapterAvailability(options = {}) {
  const availability = checkCodexExecAvailability(options);
  const available = availability.status === "PASS";

  return normalizeLegacyAvailability(
    {
      ...availability,
      provider: "codex-exec",
      remediation: getCodexExecAvailabilityRemediation(availability),
    },
    {
      provider: "codex-exec",
      requirements: [
        {
          type: "binary",
          name: "codex",
          required: true,
          available,
          command: availability.command,
        },
      ],
    },
  );
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
  runRoot,
  commandExecuted,
  externalCommandExecuted,
} = {}) {
  const didExecuteCommand = commandExecuted === undefined
    ? typeof exitCode === "number"
    : Boolean(commandExecuted);
  const capabilitiesUsed = [];
  if (didExecuteCommand) {
    capabilitiesUsed.push("externalCommand");
  }
  if (paths && paths.lastMessage) {
    capabilitiesUsed.push("lastMessage");
  }

  return normalizeAdapterResultBase({
    provider: "codex-exec",
    role,
    status,
    exitCode,
    timedOut,
    reason,
    reasons,
    paths,
    decision,
    runRoot,
    commandExecuted: didExecuteCommand,
    externalCommandExecuted: externalCommandExecuted === undefined ? didExecuteCommand : externalCommandExecuted,
    capabilitiesUsed,
  });
}

module.exports = {
  capabilities,
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
  getAdapterAvailability,
  buildCodexExecInvocation,
  runCodexExecAdapter,
  getAdapterExitCode,
  didAdapterTimeOut,
  normalizeAdapterResult,
};
