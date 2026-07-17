"use strict";

const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { runNode } = require("../harness/lib/temp-repo");

const repoRoot = path.resolve(__dirname, "..", "..");
const demo = path.join(repoRoot, "src", "demo", "supervised.js");

function runSupervisedDemoContract() {
  const result = runNode(demo, ["--json"], repoRoot, { timeout: 120000 });
  assert(result.status === 0, `deterministic supervised demo succeeds: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert(report.schemaVersion === "supervised-demo/v1-beta", "demo output is versioned");
  assert(report.status === "PASS", "demo reaches PASS");
  assert(report.runStatus === "completed", "demo explicitly finalizes the supervised run");
  assert(report.reviewerDecision === "PASS", "demo reaches independent reviewer PASS");
  assert(report.execution.owner === "managed" && report.execution.backend === "codex-exec", "demo uses the selected owner/backend pair");
  assert(report.credentialsUsed === false, "demo uses no credentials");
  assert(report.realProviderStarted === false, "demo starts no real provider");
  assert(report.modelOperations.observed === 2, "demo observes one worker and one reviewer operation");
  assert(report.localVerificationRuns >= 2, "demo keeps local verification separate from model operations");
  assert(report.receiptSchemaVersion === "supervised-receipt/v1-beta", "demo previews the real supervised receipt contract");
  assert(report.cleanup === "complete", "demo removes its temporary repository and worktree state");
}

try {
  runSupervisedDemoContract();
  console.log("[PASS] deterministic supervised demo reaches reviewer PASS without credentials");
} catch (error) {
  console.error("[FAIL] deterministic supervised demo contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
