"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const {
  getAdapterOutputPaths,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  writeAdapterLog,
  validateTimeoutSeconds,
} = require("./codex-exec");
const { buildAdapterCliCommandCandidates, probeAdapterCli } = require("./cli-probe");
const { normalizeLegacyAvailability } = require("./availability");
const { normalizeAdapterResult: normalizeAdapterResultBase } = require("./result");
const { normalizeOpenCodeModel } = require("./model");

const OPENCODE_ADAPTER = "opencode";
const OPENCODE_JSON_PARSE_EXIT_CODE = 64;

const capabilities = {
  provider: OPENCODE_ADAPTER,
  kind: "executing",
  experimental: true,
  executesExternalCommand: true,
  supportsDryRun: true,
  supportsManualHandoff: false,
  supportsResultIntake: false,
  requiresExternalBinary: true,
  requiresAuth: true,
  supportsLastMessage: true,
  executionImplemented: true,
};

const OPENCODE_COMMAND_CONTRACT = {
  provider: OPENCODE_ADAPTER,
  binary: "opencode",
  envOverride: "CEWP_OPENCODE_COMMAND",
  availabilityArgs: ["--version"],
  runArgs: ["run", "--dir", "<worktree>", "--format", "json", "<prompt>"],
  modelArgs: ["--model", "<provider/model>"],
  promptDelivery: "argv message via spawn args; no shell interpolation",
  cwd: "worker worktree for workers; run root for reviewer",
  stdout: "captured and parsed as JSON event output",
  stderr: "captured for logs and error diagnostics",
  timeout: "uses dispatch --timeout seconds",
};

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function formatPowerShellArg(value) {
  if (value === "$prompt" || value === "run" || value === "json" || String(value).startsWith("--")) {
    return value;
  }

  return quote(value);
}

function getOpenCodeCommand(env = process.env) {
  return env.CEWP_OPENCODE_COMMAND || "opencode";
}

function getOpenCodePrefixArgs(env = process.env) {
  const prefixArgs = env.CEWP_OPENCODE_PREFIX_ARGS
    ? JSON.parse(env.CEWP_OPENCODE_PREFIX_ARGS)
    : [];

  if (!Array.isArray(prefixArgs) || !prefixArgs.every((value) => typeof value === "string")) {
    throw new Error("CEWP_OPENCODE_PREFIX_ARGS must be a JSON array of strings.");
  }

  return prefixArgs;
}

function getOpenCodeCommandCandidates(env = process.env) {
  return buildAdapterCliCommandCandidates({
    binary: OPENCODE_COMMAND_CONTRACT.binary,
    envOverride: OPENCODE_COMMAND_CONTRACT.envOverride,
    env,
    windowsPackageBinaries: [
      ["node_modules", "opencode-ai", "bin", "opencode.exe"],
    ],
  });
}

function buildOpenCodeRunInvocation({ command, prefixArgs = [], worktreePath, prompt, format = "json", model } = {}) {
  const normalizedModel = normalizeOpenCodeModel(model);

  return {
    command: command || OPENCODE_COMMAND_CONTRACT.binary,
    args: [
      ...prefixArgs,
      "run",
      "--dir",
      worktreePath,
      "--format",
      format,
      ...(normalizedModel ? ["--model", normalizedModel] : []),
      prompt,
    ],
    cwd: worktreePath,
    promptDelivery: OPENCODE_COMMAND_CONTRACT.promptDelivery,
  };
}

function checkOpenCodeAvailability({ env = process.env, timeoutMs = 5000 } = {}) {
  let prefixArgs;
  try {
    prefixArgs = getOpenCodePrefixArgs(env);
  } catch (error) {
    return {
      adapter: OPENCODE_ADAPTER,
      status: "FAIL",
      reason: error.message,
      command: getOpenCodeCommand(env),
    };
  }

  const availability = probeAdapterCli({
    provider: OPENCODE_ADAPTER,
    binary: OPENCODE_COMMAND_CONTRACT.binary,
    envOverride: OPENCODE_COMMAND_CONTRACT.envOverride,
    versionArgs: OPENCODE_COMMAND_CONTRACT.availabilityArgs,
    env,
    timeoutMs,
    commandCandidates: getOpenCodeCommandCandidates(env),
    missingReason: "opencode executable not found. Install OpenCode CLI or set CEWP_OPENCODE_COMMAND.",
    availableReason: ({ override }) => (
      override
        ? "CEWP_OPENCODE_COMMAND override is set; adapter command is managed by the caller."
        : "opencode executable is available. Provider auth/model/config readiness is not verified by this check."
    ),
  });

  return {
    ...availability,
    prefixArgs,
  };
}

function getOpenCodeAvailabilityRemediation(availability) {
  if (availability.status === "PASS") {
    return null;
  }

  if (availability.reason && availability.reason.includes("opencode executable not found")) {
    return "Install OpenCode CLI or set CEWP_OPENCODE_COMMAND.";
  }

  if (availability.reason && availability.reason.includes("CEWP_OPENCODE_PREFIX_ARGS")) {
    return "Set CEWP_OPENCODE_PREFIX_ARGS to a JSON array of strings.";
  }

  return "Check the opencode executable, OpenCode authentication/configuration, or CEWP_OPENCODE_COMMAND.";
}

function getAdapterAvailability(options = {}) {
  const availability = checkOpenCodeAvailability(options);
  const available = availability.status === "PASS";

  return normalizeLegacyAvailability(
    {
      ...availability,
      provider: OPENCODE_ADAPTER,
      remediation: getOpenCodeAvailabilityRemediation(availability),
    },
    {
      provider: OPENCODE_ADAPTER,
      requirements: [
        {
          type: "binary",
          name: "opencode",
          required: true,
          available,
          command: availability.command,
        },
      ],
    },
  );
}

function printCodexExecPreview({ cwd, promptPath, outputPath, model }) {
  const command = getOpenCodeCommand();
  const invocation = buildOpenCodeRunInvocation({
    command,
    worktreePath: cwd,
    prompt: "$prompt",
    model,
  });

  console.log("OpenCode adapter preview:");
  console.log("  Status: experimental execution preview");
  console.log("  External command: not executed");
  console.log(`  Model override: ${model || "not configured"}`);
  console.log("  PowerShell preview:");
  console.log(`    $prompt = Get-Content -Raw ${quote(promptPath)}`);
  console.log(`    ${invocation.command} ${invocation.args.map(formatPowerShellArg).join(" ")}`);
  console.log(`  Prompt delivery: ${OPENCODE_COMMAND_CONTRACT.promptDelivery}`);
  console.log(`  Working directory: ${cwd}`);
  console.log(`  Stdout: ${OPENCODE_COMMAND_CONTRACT.stdout}`);
  console.log(`  Stderr: ${OPENCODE_COMMAND_CONTRACT.stderr}`);
  console.log(`  Last-message target: ${outputPath}`);
  console.log("  Execution: experimental; no process started in dry-run");
}

function stringifyOpenCodeValue(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyOpenCodeValue(entry))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (value && typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text.trim();
    }
    if (typeof value.content === "string") {
      return value.content.trim();
    }
    if (typeof value.message === "string") {
      return value.message.trim();
    }
  }

  return "";
}

function extractOpenCodeLastMessage(events) {
  for (const event of events.slice().reverse()) {
    if (!event || typeof event !== "object") {
      continue;
    }

    const candidates = [
      event.content,
      event.summary,
      event.message,
      event.text,
      event.output,
      event.result,
      event.data && event.data.content,
      event.data && event.data.summary,
      event.data && event.data.message,
    ];
    for (const candidate of candidates) {
      const value = stringifyOpenCodeValue(candidate);
      if (value) {
        return value;
      }
    }
  }

  return "";
}

function parseOpenCodeJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) {
    return {
      ok: true,
      events: [],
      lastMessage: "",
    };
  }

  try {
    const parsed = JSON.parse(text);
    const events = Array.isArray(parsed) ? parsed : [parsed];
    return {
      ok: true,
      events,
      lastMessage: extractOpenCodeLastMessage(events) || text,
    };
  } catch (wholeError) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= 1) {
      return {
        ok: false,
        error: wholeError.message,
        events: [],
        lastMessage: "",
      };
    }

    try {
      const events = lines.map((line) => JSON.parse(line));
      return {
        ok: true,
        events,
        lastMessage: extractOpenCodeLastMessage(events) || text,
      };
    } catch (lineError) {
      return {
        ok: false,
        error: lineError.message,
        events: [],
        lastMessage: "",
      };
    }
  }
}

function writeLastMessageArtifact(filePath, value) {
  const content = String(value || "").trim();
  if (!filePath || content.length === 0) {
    return false;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`);
  return true;
}

function runOpenCodeAdapter({ worktreePath, promptPath, outputLastMessagePath, timeoutSeconds, model }) {
  validateTimeoutSeconds(timeoutSeconds);
  const prompt = fs.readFileSync(promptPath, "utf8");
  const invocation = buildOpenCodeRunInvocation({
    command: getOpenCodeCommand(),
    prefixArgs: getOpenCodePrefixArgs(),
    worktreePath,
    prompt,
    model,
  });

  const result = childProcess.spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    encoding: "utf8",
    shell: false,
    timeout: timeoutSeconds * 1000,
    windowsHide: true,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const parsedOutput = parseOpenCodeJsonOutput(stdout);
  const timedOut = didAdapterTimeOut(result);
  const originalStatus = typeof result.status === "number" ? result.status : 1;
  const status = !timedOut && originalStatus === 0 && !parsedOutput.ok
    ? OPENCODE_JSON_PARSE_EXIT_CODE
    : originalStatus;
  const lastMessageSource = parsedOutput.ok && parsedOutput.lastMessage
    ? parsedOutput.lastMessage
    : stdout.trim() || stderr.trim();
  const lastMessageWritten = writeLastMessageArtifact(outputLastMessagePath, lastMessageSource);

  return {
    ...result,
    status,
    stdout,
    stderr,
    commandExecuted: true,
    externalCommandExecuted: true,
    opencode: {
      command: invocation.command,
      args: invocation.args,
      cwd: invocation.cwd,
      parsedJson: parsedOutput.ok ? parsedOutput.events : undefined,
      jsonParseError: parsedOutput.ok ? undefined : parsedOutput.error,
      lastMessageWritten,
    },
  };
}

function runDispatchAdapter(args) {
  return runOpenCodeAdapter(args);
}

function getAdapterExitCode(execResult) {
  return typeof execResult.status === "number" ? execResult.status : 1;
}

function didAdapterTimeOut(execResult) {
  return Boolean(execResult && execResult.error && execResult.error.code === "ETIMEDOUT");
}

function formatReasonDetail(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function didProduceNoOutput(execResult = {}) {
  return formatReasonDetail(execResult.stdout).length === 0
    && formatReasonDetail(execResult.stderr).length === 0;
}

function getOpenCodeBinaryLabel(execResult = {}) {
  return (execResult.opencode && execResult.opencode.command) || OPENCODE_COMMAND_CONTRACT.binary;
}

function formatExitReason(exitCode, execResult = {}) {
  if (exitCode === OPENCODE_JSON_PARSE_EXIT_CODE) {
    const detail = formatReasonDetail(execResult.opencode && execResult.opencode.jsonParseError);
    return detail
      ? `OpenCode adapter output JSON parse failed: ${detail}.`
      : "OpenCode adapter output JSON parse failed.";
  }

  const stderr = formatReasonDetail(execResult.stderr);
  if (!stderr && didProduceNoOutput(execResult)) {
    return `OpenCode adapter exited with code ${exitCode} and produced no stdout/stderr. Possible provider/auth/model/config issue; verify OpenCode directly in a disposable fixture. Binary: ${getOpenCodeBinaryLabel(execResult)}. Command shape: opencode run --dir <cwd> --format json <prompt>.`;
  }

  return stderr
    ? `OpenCode adapter exited with code ${exitCode}. stderr: ${stderr}`
    : `OpenCode adapter exited with code ${exitCode}.`;
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
    provider: OPENCODE_ADAPTER,
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
  OPENCODE_COMMAND_CONTRACT,
  OPENCODE_ADAPTER,
  OPENCODE_JSON_PARSE_EXIT_CODE,
  capabilities,
  executionName: "OpenCode adapter",
  getAdapterOutputPaths,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  writeAdapterLog,
  buildOpenCodeRunInvocation,
  getOpenCodeCommand,
  getOpenCodePrefixArgs,
  getOpenCodeCommandCandidates,
  checkAdapterAvailability: checkOpenCodeAvailability,
  checkOpenCodeAvailability,
  getAdapterAvailability,
  printCodexExecPreview,
  parseOpenCodeJsonOutput,
  runOpenCodeAdapter,
  runDispatchAdapter,
  getAdapterExitCode,
  didAdapterTimeOut,
  formatExitReason,
  normalizeAdapterResult,
};
