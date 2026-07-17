"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BLOCKED_EXECUTABLES = new Set([
  "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
  "bash", "sh", "rm", "rmdir", "del", "erase", "remove-item", "mv", "move",
]);
const BLOCKED_GIT_SUBCOMMANDS = new Set([
  "checkout", "clean", "commit", "merge", "push", "rebase", "reset",
  "restore", "switch", "worktree",
]);

function tokenizeCommand(command) {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("Verification command must be non-empty text.");
  }
  if (command.length > 2048 || /[\r\n\0]/.test(command)) {
    throw new Error("Verification command must be one bounded line (maximum 2048 characters).");
  }

  const tokens = [];
  let token = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && command[index + 1] === quote) {
        token += quote;
        index += 1;
      } else {
        token += character;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    if ("|&;<>`".includes(character) || (character === "$" && command[index + 1] === "(")) {
      throw new Error("Verification commands cannot use shell control, redirection, or command substitution.");
    }
    token += character;
  }
  if (quote) throw new Error("Verification command contains an unterminated quote.");
  if (token) tokens.push(token);
  if (tokens.length === 0) throw new Error("Verification command must include an executable.");
  return tokens;
}

function validateVerificationCommand(command) {
  const tokens = tokenizeCommand(command);
  const executableName = path.basename(tokens[0]).toLowerCase();
  if (BLOCKED_EXECUTABLES.has(executableName)) {
    throw new Error(`Unsafe verification executable: ${tokens[0]}. Use a direct, non-destructive check.`);
  }
  if (executableName === "git" || executableName === "git.exe") {
    const subcommand = String(tokens[1] || "").toLowerCase();
    if (BLOCKED_GIT_SUBCOMMANDS.has(subcommand)) {
      throw new Error(`Unsafe Git verification command: git ${subcommand}.`);
    }
  }
  if ((executableName === "npm" || executableName === "npm.cmd") && tokens[1] === "publish") {
    throw new Error("npm publish cannot be used as a verification command.");
  }
  return { command, executable: tokens[0], args: tokens.slice(1) };
}

function platformExecutable(executable) {
  if (process.platform !== "win32") return executable;
  return ["npm", "npx", "pnpm", "yarn"].includes(path.basename(executable).toLowerCase())
    ? `${executable}.cmd`
    : executable;
}

function runApprovedCommand(command, options = {}) {
  const parsed = validateVerificationCommand(command);
  const startedAtMs = Date.now();
  const result = childProcess.spawnSync(platformExecutable(parsed.executable), parsed.args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    timeout: (options.timeoutSeconds || 120) * 1000,
    windowsHide: true,
    maxBuffer: Math.max((options.maxOutputBytes || 1024 * 1024) * 2, 64 * 1024),
  });
  return {
    command,
    executable: parsed.executable,
    args: parsed.args,
    exitCode: typeof result.status === "number" ? result.status : 1,
    timedOut: Boolean(result.error && result.error.code === "ETIMEDOUT"),
    durationMs: Date.now() - startedAtMs,
    stdout: result.stdout || "",
    stderr: `${result.stderr || ""}${result.error ? result.error.message : ""}`,
  };
}

function normalizeFailureText(value, worktreePath) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(path.resolve(worktreePath)).join("<worktree>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<timestamp>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8192);
}

function makeFailureSignature(result, worktreePath) {
  if (result.exitCode === 0 && !result.timedOut) return null;
  const normalized = [
    `exit=${result.exitCode}`,
    `timeout=${result.timedOut}`,
    normalizeFailureText(result.stdout, worktreePath),
    normalizeFailureText(result.stderr, worktreePath),
  ].join("\n");
  return `sha256:${crypto.createHash("sha256").update(normalized).digest("hex")}`;
}

function writeBoundedLog(filePath, value, maxBytes) {
  const input = Buffer.from(value || "", "utf8");
  const output = input.subarray(0, Math.max(0, maxBytes));
  fs.writeFileSync(filePath, output);
  return {
    capturedBytes: output.length,
    originalBytes: input.length,
    truncated: input.length > output.length,
  };
}

module.exports = {
  makeFailureSignature,
  runApprovedCommand,
  tokenizeCommand,
  validateVerificationCommand,
  writeBoundedLog,
};
