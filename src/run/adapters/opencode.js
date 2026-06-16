"use strict";

const childProcess = require("node:child_process");
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

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function getOpenCodeCommand(env = process.env) {
  return env.CEWP_OPENCODE_COMMAND || "opencode";
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

  const result = childProcess.spawnSync(command, ["--version"], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error && result.error.code === "ENOENT") {
    return {
      adapter: OPENCODE_ADAPTER,
      status: "FAIL",
      reason: "opencode executable not found. Install OpenCode CLI or set CEWP_OPENCODE_COMMAND.",
      command,
    };
  }

  if (result.error) {
    return {
      adapter: OPENCODE_ADAPTER,
      status: "FAIL",
      reason: `opencode availability check failed: ${result.error.message}`,
      command,
    };
  }

  if (result.status !== 0) {
    return {
      adapter: OPENCODE_ADAPTER,
      status: "FAIL",
      reason: `opencode --version exited with code ${typeof result.status === "number" ? result.status : 1}.`,
      command,
    };
  }

  return {
    adapter: OPENCODE_ADAPTER,
    status: "PASS",
    reason: "opencode executable is available. Authentication and model/provider configuration are managed by OpenCode.",
    command,
    version: String(result.stdout || result.stderr || "").trim(),
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

  console.log("OpenCode adapter preview:");
  console.log("  Status: experimental dry-run only");
  console.log("  External command: not executed");
  console.log("  Intended command preview:");
  console.log(`    ${command} run --cwd ${quote(cwd)} --prompt-file ${quote(promptPath)} --output-last-message ${quote(outputPath)}`);
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
  OPENCODE_ADAPTER,
  OPENCODE_NOT_IMPLEMENTED_REASON,
  capabilities,
  executionName: "OpenCode adapter",
  getAdapterOutputPaths,
  getWorkerOutputPaths,
  copyWorkerOutputToRun,
  writeAdapterLog,
  getOpenCodeCommand,
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
