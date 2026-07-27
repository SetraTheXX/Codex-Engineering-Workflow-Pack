"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { runNode } = require("../harness/lib/temp-repo");
const { assessDowngradeCompatibility } = require("../../src/compatibility/contract");

const repoRoot = path.resolve(__dirname, "..", "..");
const cewpCli = path.join(repoRoot, "bin", "cewp.js");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function runContract() {
  const result = runNode(cewpCli, ["compatibility", "--json"], repoRoot);
  assert(result.status === 0, `compatibility command succeeds: ${result.stderr}`);
  const contract = JSON.parse(result.stdout);
  assert(contract.schemaVersion === "stable-compatibility/v1", "compatibility output has a stable schema");
  assert(contract.packageVersion === "0.14.0-beta.1", "package is prepared for the current Phase 14 stable-core beta");
  assert(contract.release.status === "phase-13-complete-release-validation-required", "compatibility reports Phase 13 complete without claiming publication");
  assert(contract.release.phase13.validationModel === "maintainer-technical-acceptance", "compatibility names the approved Phase 13 model");
  assert(contract.release.phase13.independentUserValidationRequired === false, "compatibility removes independent-user quotas");
  assert(JSON.stringify(contract.runtime.node.majors) === JSON.stringify([22, 24, 26]), "tested Node majors are explicit");
  assert(contract.execution.managedBackend.id === "codex-exec", "codex-exec remains the stable managed backend");
  assert(contract.execution.appServer.status === "experimental-not-graduated", "App Server remains ungraduated");
  assert(contract.execution.owners.join(",") === "managed,native,audit-only", "stable execution owners remain explicit");
  assert(contract.hostClaims.nativeCompletionIsVerification === false, "native completion cannot become CEWP verification");
  assert(contract.hostClaims.unknownUsageBecomesZero === false, "unknown usage never becomes zero");
  const downgrade = assessDowngradeCompatibility("0.13.0-beta.0", "0.14.0-beta.0");
  assert(downgrade.compatible === false && downgrade.warning.code === "package-downgrade-state-newer", "newer state produces an explicit downgrade warning");
  const sameLine = assessDowngradeCompatibility("0.14.0-beta.0", "0.13.0-beta.0");
  assert(sameLine.compatible === true && sameLine.warning === null, "newer reader accepts older package state subject to schema migration");

  const requiredDocs = [
    "docs/stable-compatibility.md",
    "docs/migration-policy.md",
    "docs/security-review-1.0.md",
    "docs/recovery-guide.md",
    "docs/performance-budgets.md",
    "docs/contracts.md",
    "docs/native-goal-or-cewp.md",
  ];
  for (const file of requiredDocs) assert(fs.existsSync(path.join(repoRoot, file)), `${file} exists`);

  const migration = read("docs/migration-policy.md");
  for (const phrase of ["deprecation", "downgrade warning", "read-only", "supervised-run/v1", "run-state/v2"]) {
    assert(migration.toLowerCase().includes(phrase.toLowerCase()), `migration policy covers ${phrase}`);
  }
  const recovery = read("docs/recovery-guide.md");
  for (const phrase of ["interrupted native goal", "failed cancellation", "deleted worktree", "ownership conflict", "corrupted events", "host limit", "partial review"]) {
    assert(recovery.toLowerCase().includes(phrase), `recovery guide covers ${phrase}`);
  }
  const security = read("docs/security-review-1.0.md");
  for (const phrase of ["path containment", "command construction", "hook trust", "mcp", "redaction", "symlink", "imported evidence", "provider output"]) {
    assert(security.toLowerCase().includes(phrase), `security review covers ${phrase}`);
  }
  assert(security.includes("P0/P1"), "security review states the severity release gate");

}

try {
  runContract();
  console.log("[PASS] stable core compatibility and documentation contract");
} catch (error) {
  console.error("[FAIL] stable core compatibility and documentation contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
