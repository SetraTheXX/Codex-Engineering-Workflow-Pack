#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");

process.stdin.setEncoding("utf8");
let input = "";
let oversized = false;
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input, "utf8") > 64 * 1024) oversized = true;
});
process.stdin.on("end", () => {
  try {
    if (oversized) throw new Error("hook input exceeds 65536 bytes");
    JSON.parse(input || "{}");
    const command = process.env.CEWP_HOOK_CLI_COMMAND || (process.platform === "win32" ? "cewp.cmd" : "cewp");
    const prefixArgs = process.env.CEWP_HOOK_CLI_PREFIX_ARGS
      ? JSON.parse(process.env.CEWP_HOOK_CLI_PREFIX_ARGS)
      : [];
    if (!Array.isArray(prefixArgs) || prefixArgs.some((value) => typeof value !== "string")) {
      throw new Error("invalid CEWP hook CLI prefix configuration");
    }
    const result = childProcess.spawnSync(command, [
      ...prefixArgs,
      "integration", "hooks", "ingest",
    ], {
      cwd: process.cwd(),
      input,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      shell: process.platform === "win32" && !process.env.CEWP_HOOK_CLI_COMMAND,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const reason = String(result.stderr || "CEWP hook ingestion failed")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1000);
      throw new Error(reason);
    }
    process.stdout.write("{}\n");
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      systemMessage: `CEWP hook evidence unavailable: ${error.message} Core gates remain unchanged.`,
    })}\n`);
  }
});
