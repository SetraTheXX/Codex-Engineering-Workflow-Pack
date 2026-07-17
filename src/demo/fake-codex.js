"use strict";

const fs = require("node:fs");
const path = require("node:path");

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function emitUsage(role, usage) {
  console.log(JSON.stringify({ type: "turn.started", role }));
  console.log(JSON.stringify({ type: "turn.completed", role, usage }));
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "exec") {
    throw new Error("CEWP demo fake Codex supports only exec.");
  }
  const worktreePath = valueAfter(args, "--cd");
  const sandbox = valueAfter(args, "--sandbox");
  const lastMessagePath = valueAfter(args, "--output-last-message");
  const prompt = args.at(-1) || "";
  if (!worktreePath || !lastMessagePath || !args.includes("--json")) {
    throw new Error("CEWP demo fake Codex requires structured exec arguments.");
  }
  fs.mkdirSync(path.dirname(lastMessagePath), { recursive: true });

  if (prompt.includes("CEWP Dispatch Prompt - Reviewer")) {
    if (sandbox !== "read-only") {
      throw new Error("CEWP demo reviewer must be read-only.");
    }
    fs.writeFileSync(lastMessagePath, "Decision: PASS\n\nDeterministic demo reviewer accepted the bounded change.\n");
    emitUsage("reviewer", {
      input_tokens: 60,
      cached_input_tokens: 40,
      output_tokens: 15,
      reasoning_output_tokens: 4,
    });
    return;
  }

  if (sandbox !== "workspace-write") {
    throw new Error("CEWP demo worker must use the isolated writable worktree.");
  }
  fs.writeFileSync(
    path.join(worktreePath, "README.md"),
    "# CEWP Demo Repository\n\nThe bounded supervised checkpoint completed.\n",
  );
  fs.writeFileSync(lastMessagePath, "Deterministic demo worker changed only README.md.\n");
  emitUsage("worker-a", {
    input_tokens: 100,
    cached_input_tokens: 80,
    output_tokens: 20,
    reasoning_output_tokens: 5,
  });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
