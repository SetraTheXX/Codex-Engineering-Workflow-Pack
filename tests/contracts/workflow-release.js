"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");

const repoRoot = path.join(__dirname, "..", "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const plugin = JSON.parse(fs.readFileSync(
  path.join(repoRoot, "plugins", "cewp", ".codex-plugin", "plugin.json"),
  "utf8",
));
const releaseNotes = fs.readFileSync(path.join(repoRoot, "docs", "release-notes.md"), "utf8");

function runWorkflowReleaseContract() {
  const version = packageJson.version.match(/^0\.(\d+)\.0-beta\.0$/);
  assert(version && Number.parseInt(version[1], 10) >= 12, "current beta remains at or beyond the Phase 12 package line");
  assert(plugin.version === packageJson.version, "plugin version follows the package version");

  const unreleasedIndex = releaseNotes.indexOf("## Unreleased");
  const releaseIndex = releaseNotes.indexOf("## 0.12.0-beta.0");
  const previousIndex = releaseNotes.indexOf("## 0.11.0-beta.0");
  assert(unreleasedIndex >= 0 && releaseIndex > unreleasedIndex, "fresh Unreleased precedes the Phase 12 release");
  assert(previousIndex > releaseIndex, "Phase 12 release precedes earlier release history");
  const unreleased = releaseNotes.slice(unreleasedIndex, releaseIndex);
  assert(unreleased.includes("No changes yet."), "fresh Unreleased is explicitly empty");
  for (const claim of [
    "`evidence-receipt/v1`",
    "`event/v1`",
    "`usage-observation/v1`",
    "`usage-estimate/v1`",
    "`operator-report/v1`",
    "`run-comparison/v1`",
    "`redaction-policy/v1`",
    "`cewp run verify`",
    "audit-only",
    "unavailable native usage remains unknown",
    "clean Linux validation remains required",
    "No publish, tag, or release",
  ]) {
    assert(releaseNotes.slice(releaseIndex, previousIndex).includes(claim), `Phase 12 notes include honest claim: ${claim}`);
  }
  assert(packageJson.files.includes("docs/evidence-receipts.md"), "Phase 12 evidence guide is in the package surface");
}

try {
  runWorkflowReleaseContract();
  console.log("[PASS] Phase 12 version and release surface are aligned");
} catch (error) {
  console.error("[FAIL] Phase 12 release surface contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
