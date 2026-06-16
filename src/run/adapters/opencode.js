"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  getAdapterOutputPaths,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  writeAdapterLog,
} = require("./codex-exec");
const { normalizeLegacyAvailability } = require("./availability");
const { normalizeAdapterResult: normalizeAdapterResultBase } = require("./result");

const OPENCODE_ADAPTER = "opencode";
const OPENCODE_NOT_IMPLEMENTED_REASON = "OpenCode adapter execution is not implemented yet; use --dry-run only.";

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
  supportsLastMessage: false,
  executionImplemented: false,
};

const OPENCODE_COMMAND_CONTRACT = {
  provider: OPENCODE_ADAPTER,
  binary: "opencode",
  envOverride: "CEWP_OPENCODE_COMMAND",
  availabilityArgs: ["--version"],
  runArgs: ["run", "--dir", "<worktree>", "--format", "json", "<prompt>"],
  promptDelivery: "argv message via spawn args; no shell interpolation",
  cwd: "worker worktree for workers; run root for reviewer",
  stdout: "captured for future JSON event parsing",
  stderr: "captured for logs and error diagnostics",
  timeout: "uses dispatch --timeout seconds when execution is implemented",
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

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getPathEntries(env = process.env) {
  return String(env.PATH || env.Path || "")
    .split(path.delimiter)
    .filter((value) => value.length > 0);
}

function getOpenCodeCommandCandidates(env = process.env) {
  if (env.CEWP_OPENCODE_COMMAND) {
    return [env.CEWP_OPENCODE_COMMAND];
  }

  const candidates = [OPENCODE_COMMAND_CONTRACT.binary];
  if (process.platform === "win32") {
    for (const pathEntry of getPathEntries(env)) {
      candidates.push(path.join(pathEntry, "opencode.exe"));
      const npmPackageBinary = path.join(pathEntry, "node_modules", "opencode-ai", "bin", "opencode.exe");
      if (fs.existsSync(npmPackageBinary)) {
        candidates.push(npmPackageBinary);
      }
    }
  }

  return unique(candidates);
}

function buildOpenCodeRunInvocation({ command, worktreePath, prompt, format = "json" } = {}) {
  return {
    command: command || OPENCODE_COMMAND_CONTRACT.binary,
    args: [
      "run",
      "--dir",
      worktreePath,
      "--format",
      format,
      prompt,
    ],
    cwd: worktreePath,
    promptDelivery: OPENCODE_COMMAND_CONTRACT.promptDelivery,
  };
}

function checkOpenCodeAvailability({ env = process.env, timeoutMs = 5000 } = {}) {
  const command = getOpenCodeCommand(env);

  if (env.CEWP_OPENCODE_COMMAND) {
    return {
      adapter: OPENCODE_ADAPTER,
      status: "PASS",
      reason: "CEWP_OPENCODE_COMMAND override is set; adapter command is managed by the caller.",
      command,
      override: true,
    };
  }

  const candidates = getOpenCodeCommandCandidates(env);
  let lastResult;
  let lastCommand = command;

  for (const candidate of candidates) {
    const result = childProcess.spawnSync(candidate, OPENCODE_COMMAND_CONTRACT.availabilityArgs, {
      encoding: "utf8",
      env,
      shell: false,
      timeout: timeoutMs,
      windowsHide: true,
    });
    lastResult = result;
    lastCommand = candidate;

    if (result.error && result.error.code === "ENOENT") {
      continue;
    }

    if (result.error) {
      return {
        adapter: OPENCODE_ADAPTER,
        status: "FAIL",
        reason: `opencode availability check failed: ${result.error.message}`,
        command: candidate,
      };
    }

    if (result.status !== 0) {
      return {
        adapter: OPENCODE_ADAPTER,
        status: "FAIL",
        reason: `opencode --version exited with code ${typeof result.status === "number" ? result.status : 1}.`,
        command: candidate,
      };
    }

    const version = String(result.stdout || result.stderr || "").trim();
    const versionSuffix = version ? ` (${version})` : "";

    return {
      adapter: OPENCODE_ADAPTER,
      status: "PASS",
      reason: `opencode executable is available${versionSuffix}. Authentication and model/provider configuration are managed by OpenCode.`,
      command: candidate,
      version,
    };
  }

  if (lastResult && lastResult.error && lastResult.error.code === "ENOENT") {
    return {
      adapter: OPENCODE_ADAPTER,
      status: "FAIL",
      reason: "opencode executable not found. Install OpenCode CLI or set CEWP_OPENCODE_COMMAND.",
      command: lastCommand,
    };
  }

  return {
    adapter: OPENCODE_ADAPTER,
    status: "FAIL",
    reason: "opencode executable not found. Install OpenCode CLI or set CEWP_OPENCODE_COMMAND.",
    command: lastCommand,
  };
}

function getOpenCodeAvailabilityRemediation(availability) {
  if (availability.status === "PASS") {
    return null;
  }

  if (availability.reason && availability.reason.includes("opencode executable not found")) {
    return "Install OpenCode CLI or set CEWP_OPENCODE_COMMAND.";
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

function printCodexExecPreview({ cwd, promptPath, outputPath }) {
  const command = getOpenCodeCommand();
  const invocation = buildOpenCodeRunInvocation({
    command,
    worktreePath: cwd,
    prompt: "$prompt",
  });

  console.log("OpenCode adapter preview:");
  console.log("  Status: experimental dry-run only");
  console.log("  External command: not executed");
  console.log("  PowerShell preview:");
  console.log(`    $prompt = Get-Content -Raw ${quote(promptPath)}`);
  console.log(`    ${invocation.command} ${invocation.args.map(formatPowerShellArg).join(" ")}`);
  console.log(`  Prompt delivery: ${OPENCODE_COMMAND_CONTRACT.promptDelivery}`);
  console.log(`  Working directory: ${cwd}`);
  console.log(`  Stdout: ${OPENCODE_COMMAND_CONTRACT.stdout}`);
  console.log(`  Stderr: ${OPENCODE_COMMAND_CONTRACT.stderr}`);
  console.log(`  Last-message target: ${outputPath}`);
  console.log("  Execution: not implemented");
}

function runDispatchAdapter() {
  return {
    status: 1,
    stdout: `${OPENCODE_NOT_IMPLEMENTED_REASON}\nExternal command: not executed\n`,
    stderr: "",
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
  return OPENCODE_NOT_IMPLEMENTED_REASON;
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
} = {}) {
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
    commandExecuted: false,
    externalCommandExecuted: false,
    capabilitiesUsed: [],
  });
}

module.exports = {
  OPENCODE_COMMAND_CONTRACT,
  OPENCODE_ADAPTER,
  OPENCODE_NOT_IMPLEMENTED_REASON,
  capabilities,
  executionName: "OpenCode adapter",
  getAdapterOutputPaths,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  writeAdapterLog,
  buildOpenCodeRunInvocation,
  getOpenCodeCommand,
  getOpenCodeCommandCandidates,
  checkAdapterAvailability: checkOpenCodeAvailability,
  checkOpenCodeAvailability,
  getAdapterAvailability,
  printCodexExecPreview,
  runDispatchAdapter,
  getAdapterExitCode,
  didAdapterTimeOut,
  formatExitReason,
  normalizeAdapterResult,
};
