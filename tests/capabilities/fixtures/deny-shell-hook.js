"use strict";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  JSON.parse(input || "{}");
  process.stdout.write(`${JSON.stringify({
    systemMessage: "CEWP hook probe warning.",
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "CEWP hook probe denied the shell command.",
    },
  })}\n`);
});
