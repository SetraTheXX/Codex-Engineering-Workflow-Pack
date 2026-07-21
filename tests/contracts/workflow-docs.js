"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  CHECKPOINT_TRANSITIONS,
  RUN_TRANSITIONS,
  TASK_TRANSITIONS,
} = require("../../src/workflow/transitions");

const repoRoot = path.join(__dirname, "..", "..");
const runtimeDocPath = path.join(repoRoot, "docs", "workflow-runtime.md");

function assertTransitionTable(kind, table, document) {
  const states = new Set(Object.keys(table));
  for (const [state, transitions] of Object.entries(table)) {
    for (const [event, target] of Object.entries(transitions)) {
      assert(states.has(target), `${kind} transition target is a declared state: ${state} + ${event} -> ${target}`);
      const documented = `\`${state} + ${event} -> ${target}\``;
      assert(document.includes(documented), `${kind} transition is documented exactly: ${documented}`);
    }
  }
}

function incomingTransitions(table, target) {
  const incoming = [];
  for (const [state, transitions] of Object.entries(table)) {
    for (const [event, next] of Object.entries(transitions)) {
      if (next === target) incoming.push(`${state}:${event}`);
    }
  }
  return incoming.sort();
}

function runWorkflowDocsContract() {
  assert(fs.existsSync(runtimeDocPath), "workflow runtime documentation is public");
  const document = fs.readFileSync(runtimeDocPath, "utf8");
  for (const contract of [
    "workflow-compiler-request/v1",
    "workflow-definition/v1",
    "run-state/v2",
    "task-checkpoint/v1",
    "budget-envelope/v1",
    "task-result/v1",
    "progress-view/v1",
  ]) {
    assert(document.includes(`\`${contract}\``), `runtime documentation names ${contract}`);
  }
  for (const boundary of [
    "does not execute prose",
    "explicit approval",
    "derived projection",
    "OpenCode remains experimental",
    "does not merge, push, publish, or tag",
  ]) {
    assert(document.includes(boundary), `runtime documentation preserves boundary: ${boundary}`);
  }

  assertTransitionTable("task", TASK_TRANSITIONS, document);
  assertTransitionTable("checkpoint", CHECKPOINT_TRANSITIONS, document);
  assertTransitionTable("run", RUN_TRANSITIONS, document);
  assert(
    incomingTransitions(TASK_TRANSITIONS, "completed").join(",") === "review-pending:reviewer-pass,verifying:verification-passed",
    "task completion has only verification or reviewer PASS entrances",
  );
  assert(
    incomingTransitions(CHECKPOINT_TRANSITIONS, "verified").join(",") === "result-recorded:verification-passed",
    "checkpoint verification requires a recorded result",
  );
  assert(
    incomingTransitions(RUN_TRANSITIONS, "completed").join(",") === "active:tasks-completed-no-review,review-pending:reviewer-pass",
    "run completion cannot bypass configured review",
  );
  assert(
    incomingTransitions(RUN_TRANSITIONS, "finalized").join(",") === "completed:finalize",
    "finalization is reachable only from completed",
  );

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert(packageJson.files.includes("docs/workflow-runtime.md"), "workflow runtime documentation ships in the package");
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  assert(readme.includes("docs/workflow-runtime.md"), "README links the workflow runtime guide");
}

try {
  runWorkflowDocsContract();
  console.log("[PASS] workflow transitions are documented and machine validated");
} catch (error) {
  console.error("[FAIL] workflow runtime documentation contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
