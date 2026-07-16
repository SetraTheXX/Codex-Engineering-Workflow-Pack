"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");
const { assert, assertExit } = require("../harness/lib/assertions");

const hookPath = path.join(__dirname, "..", "capabilities", "fixtures", "deny-shell-hook.js");

try {
  const child = childProcess.spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "echo CEWP_HOOK_PROBE" },
    }),
    encoding: "utf8",
    windowsHide: true,
  });
  const result = {
    command: `${process.execPath} ${hookPath}`,
    status: child.status,
    stdout: child.stdout || "",
    stderr: child.stderr || "",
  };
  assertExit(result, 0, "hook output fixture");

  const output = JSON.parse(result.stdout);
  assert(output.systemMessage === "CEWP hook probe warning.", "hook warning message");
  assert(
    output.hookSpecificOutput.hookEventName === "PreToolUse",
    "hook event name",
  );
  assert(
    output.hookSpecificOutput.permissionDecision === "deny",
    "hook deny decision",
  );
  assert(
    output.hookSpecificOutput.permissionDecisionReason.includes("denied"),
    "hook deny reason",
  );

  const documentedBoundary = {
    intercepted: ["Bash", "apply_patch", "MCP"],
    incompleteOrNotIntercepted: ["unified_exec", "WebSearch", "non-MCP tools"],
  };
  assert(documentedBoundary.intercepted.includes("Bash"), "documented Bash hook surface");
  assert(
    documentedBoundary.incompleteOrNotIntercepted.includes("unified_exec"),
    "documented incomplete shell interception",
  );

  console.log("[PASS] hook warning and deny output contract");
} catch (error) {
  console.error("[FAIL] hook warning and deny output contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
