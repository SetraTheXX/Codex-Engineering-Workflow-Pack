"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getPathEntries(env = process.env) {
  return String(env.PATH || env.Path || "")
    .split(path.delimiter)
    .filter((value) => value.length > 0);
}

function buildAdapterCliCommandCandidates({
  binary,
  envOverride,
  env = process.env,
  windowsPackageBinaries = [],
} = {}) {
  if (envOverride && env[envOverride]) {
    return [env[envOverride]];
  }

  const candidates = [binary];
  if (process.platform === "win32") {
    for (const pathEntry of getPathEntries(env)) {
      candidates.push(path.join(pathEntry, `${binary}.exe`));
      for (const packageBinary of windowsPackageBinaries) {
        const segments = Array.isArray(packageBinary) ? packageBinary : [packageBinary];
        const candidate = path.join(pathEntry, ...segments);
        if (fs.existsSync(candidate)) {
          candidates.push(candidate);
        }
      }
    }
  }

  return unique(candidates);
}

function normalizeOutput(value) {
  return String(value || "").trim();
}

function defaultAvailableReason(binary) {
  return `${binary} executable is available.`;
}

function defaultMissingReason(binary, envOverride) {
  return `${binary} executable not found.${envOverride ? ` Install ${binary} CLI or set ${envOverride}.` : ""}`;
}

function buildProbe({ command, args, helpArgs = [], result } = {}) {
  return {
    command,
    args,
    helpArgs,
    stdout: normalizeOutput(result && result.stdout),
    stderr: normalizeOutput(result && result.stderr),
    exitCode: result && typeof result.status === "number" ? result.status : null,
    errorCode: result && result.error ? result.error.code : undefined,
    timedOut: Boolean(result && result.error && result.error.code === "ETIMEDOUT"),
  };
}

function probeAdapterCli({
  provider,
  binary,
  envOverride,
  env = process.env,
  versionArgs = ["--version"],
  helpArgs = [],
  timeoutMs = 5000,
  commandCandidates,
  windowsPackageBinaries = [],
  missingReason,
  availableReason,
} = {}) {
  const candidates = commandCandidates || buildAdapterCliCommandCandidates({
    binary,
    envOverride,
    env,
    windowsPackageBinaries,
  });
  const override = Boolean(envOverride && env[envOverride]);
  let lastProbe = {
    command: candidates[0] || binary,
    args: versionArgs,
    helpArgs,
    stdout: "",
    stderr: "",
    exitCode: null,
    errorCode: undefined,
    timedOut: false,
  };

  for (const candidate of candidates) {
    const result = childProcess.spawnSync(candidate, versionArgs, {
      encoding: "utf8",
      env,
      shell: false,
      timeout: timeoutMs,
      windowsHide: true,
    });
    const probe = buildProbe({ command: candidate, args: versionArgs, helpArgs, result });
    lastProbe = probe;

    if (result.error && result.error.code === "ENOENT") {
      continue;
    }

    if (result.error) {
      return {
        adapter: provider,
        status: "FAIL",
        reason: `${binary} availability check failed: ${result.error.message}`,
        command: candidate,
        stdout: probe.stdout,
        stderr: probe.stderr,
        probe,
      };
    }

    if (result.status !== 0) {
      return {
        adapter: provider,
        status: "FAIL",
        reason: `${binary} ${versionArgs.join(" ")} exited with code ${typeof result.status === "number" ? result.status : 1}.`,
        command: candidate,
        stdout: probe.stdout,
        stderr: probe.stderr,
        probe,
      };
    }

    const version = probe.stdout || probe.stderr;
    const reason = typeof availableReason === "function"
      ? availableReason({ command: candidate, version, override })
      : availableReason || defaultAvailableReason(binary);

    return {
      adapter: provider,
      status: "PASS",
      reason,
      command: candidate,
      version,
      stdout: probe.stdout,
      stderr: probe.stderr,
      override,
      probe,
    };
  }

  return {
    adapter: provider,
    status: "FAIL",
    reason: missingReason || defaultMissingReason(binary, envOverride),
    command: lastProbe.command,
    stdout: lastProbe.stdout,
    stderr: lastProbe.stderr,
    probe: lastProbe,
  };
}

module.exports = {
  buildAdapterCliCommandCandidates,
  probeAdapterCli,
};
