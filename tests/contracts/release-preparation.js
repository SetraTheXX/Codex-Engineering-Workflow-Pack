"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");

const repoRoot = path.resolve(__dirname, "..", "..");

function runContract() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert(packageJson.scripts["release:plan"] === "node scripts/prepare-release.js --plan --json", "release planning is deterministic and read-only");
  assert(packageJson.scripts["release:prepare"] === "node scripts/prepare-release.js --yes", "artifact preparation requires explicit approval");
  const source = fs.readFileSync(path.join(repoRoot, "scripts", "prepare-release.js"), "utf8");
  for (const forbidden of ["npm publish", "git tag", "gh release", "git push"]) {
    assert(!source.includes(forbidden), `release preparation never embeds ${forbidden}`);
  }
  const planResult = require("node:child_process").spawnSync(process.execPath, [
    path.join(repoRoot, "scripts", "prepare-release.js"), "--plan", "--json",
  ], { cwd: repoRoot, encoding: "utf8", shell: false, windowsHide: true });
  assert(planResult.status === 0, `release plan succeeds: ${planResult.stderr}`);
  const plan = JSON.parse(planResult.stdout);
  assert(plan.schemaVersion === "release-preparation/v1", "release preparation plan is versioned");
  assert(plan.externalActions.every((entry) => entry.automatic === false && entry.humanApprovalRequired === true), "publish, tag, and release stay human-approved");
  assert(plan.blockers.includes("exact-release-matrix"), "the exact release matrix remains a release gate");
  assert(plan.blockers.includes("clean-release-source"), "release preparation requires a clean source boundary");
}

try {
  runContract();
  console.log("[PASS] local release preparation preserves human release approval");
} catch (error) {
  console.error("[FAIL] local release preparation contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
