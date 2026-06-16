"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeAdapterResult } = require("../../../src/run/adapters/result");

const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "fake-external-cli.js");
const PROVIDER = "fake-external";
const ROLE = "worker-a";

function buildFakeExternalInvocation({
  nodePath,
  worktreePath,
  promptPath,
  outputLastMessagePath,
  mode,
}) {
  return {
    command: nodePath,
    args: [
      FIXTURE_PATH,
      "--mode",
      mode,
      "--prompt-file",
      promptPath,
      "--last-message",
      outputLastMessagePath,
    ],
    cwd: worktreePath,
  };
}

function getAdapterOutputPaths(runRoot, role) {
  const adapterOutputRoot = path.join(runRoot, "adapter-output");
  return {
    adapterOutputRoot,
    stdoutPath: path.join(adapterOutputRoot, `${role}-stdout.log`),
    stderrPath: path.join(adapterOutputRoot, `${role}-stderr.log`),
    outputLastMessagePath: path.join(adapterOutputRoot, `${role}-last-message.md`),
  };
}

function parseStructuredOutput(stdout) {
  try {
    return {
      parsed: JSON.parse(stdout),
      error: undefined,
    };
  } catch (error) {
    return {
      parsed: undefined,
      error,
    };
  }
}

function normalizeFakeExternalRun({
  runRoot,
  role,
  execResult,
  stdoutPath,
  stderrPath,
  outputLastMessagePath,
  timeoutSeconds,
}) {
  const exitCode = typeof execResult.status === "number" ? execResult.status : 1;
  const timedOut = Boolean(execResult.error && execResult.error.code === "ETIMEDOUT");
  const structured = timedOut ? { parsed: undefined, error: undefined } : parseStructuredOutput(execResult.stdout || "");
  const reasons = [];

  if (timedOut) {
    reasons.push(`fake external cli timed out after ${timeoutSeconds}s.`);
  } else if (exitCode !== 0) {
    reasons.push(`fake external cli exited with code ${exitCode}.`);
  } else if (structured.error) {
    reasons.push(`structured JSON parse failed: ${structured.error.message}`);
  }

  const capabilitiesUsed = ["externalCommand"];
  if (structured.parsed) {
    capabilitiesUsed.push("structuredJson");
  }
  if (fs.existsSync(outputLastMessagePath)) {
    capabilitiesUsed.push("lastMessage");
  }

  return {
    parsed: structured.parsed,
    result: normalizeAdapterResult({
      provider: PROVIDER,
      role,
      status: reasons.length === 0 ? "PASS" : "FAIL",
      exitCode,
      timedOut,
      reason: reasons[0],
      reasons,
      runRoot,
      commandExecuted: true,
      externalCommandExecuted: true,
      capabilitiesUsed,
      paths: {
        stdout: stdoutPath,
        stderr: stderrPath,
        lastMessage: outputLastMessagePath,
      },
    }),
  };
}

function runFakeExternalMode({ nodePath, runRoot, worktreePath, promptPath, mode, timeoutSeconds }) {
  const outputPaths = getAdapterOutputPaths(runRoot, ROLE);
  fs.mkdirSync(outputPaths.adapterOutputRoot, { recursive: true });
  const invocation = buildFakeExternalInvocation({
    nodePath,
    worktreePath,
    promptPath,
    outputLastMessagePath: outputPaths.outputLastMessagePath,
    mode,
  });
  const execResult = childProcess.spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    encoding: "utf8",
    shell: false,
    timeout: timeoutSeconds * 1000,
    windowsHide: true,
  });

  fs.writeFileSync(outputPaths.stdoutPath, execResult.stdout || "");
  fs.writeFileSync(outputPaths.stderrPath, execResult.stderr || "");

  return {
    invocation,
    stdout: execResult.stdout || "",
    stderr: execResult.stderr || "",
    ...normalizeFakeExternalRun({
      runRoot,
      role: ROLE,
      execResult,
      stdoutPath: outputPaths.stdoutPath,
      stderrPath: outputPaths.stderrPath,
      outputLastMessagePath: outputPaths.outputLastMessagePath,
      timeoutSeconds,
    }),
  };
}

function runFakeExternalAdapterContract({ nodePath, tempRoot }) {
  const runRoot = path.join(tempRoot, ".cewp", "runs", "fake-external-run");
  const worktreePath = path.join(tempRoot, "worktree");
  const promptPath = path.join(runRoot, "dispatch-prompts", "worker-a-prompt.md");
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.writeFileSync(promptPath, "Fake external adapter prompt");

  return {
    tempRoot,
    runRoot,
    worktreePath,
    success: runFakeExternalMode({ nodePath, runRoot, worktreePath, promptPath, mode: "success", timeoutSeconds: 2 }),
    invalidJson: runFakeExternalMode({ nodePath, runRoot, worktreePath, promptPath, mode: "invalid-json", timeoutSeconds: 2 }),
    nonzero: runFakeExternalMode({ nodePath, runRoot, worktreePath, promptPath, mode: "nonzero", timeoutSeconds: 2 }),
    timeout: runFakeExternalMode({ nodePath, runRoot, worktreePath, promptPath, mode: "timeout", timeoutSeconds: 1 }),
  };
}

module.exports = {
  buildFakeExternalInvocation,
  runFakeExternalAdapterContract,
};
