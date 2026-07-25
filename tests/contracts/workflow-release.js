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
  assert(packageJson.version === "0.11.0-beta.0", "Phase 11 package version is exact");
  assert(plugin.version === packageJson.version, "plugin version follows the package version");

  const unreleasedIndex = releaseNotes.indexOf("## Unreleased");
  const releaseIndex = releaseNotes.indexOf("## 0.11.0-beta.0");
  const previousIndex = releaseNotes.indexOf("## 0.10.0-beta.0");
  assert(unreleasedIndex >= 0 && releaseIndex > unreleasedIndex, "fresh Unreleased precedes the Phase 11 release");
  assert(previousIndex > releaseIndex, "Phase 11 release precedes earlier release history");
  const unreleased = releaseNotes.slice(unreleasedIndex, releaseIndex);
  assert(unreleased.includes("Phase 12 development"), "post-Phase 11 work remains in Unreleased");
  for (const claim of [
    "native and managed ownership",
    "no automatic model routing",
    "SubagentStart",
    "eight Core-backed MCP tools",
    "observed, imported, stale, malformed, unavailable, and unknown",
    "audit-only",
    "App Server remains ungraduated",
    "`codex-exec` fallback",
    "external pilot evidence remains Phase 13 validation debt",
    "No provider, desktop UI, terminal server, merge, push, publish, tag, or release automation",
  ]) {
    assert(releaseNotes.slice(releaseIndex, previousIndex).includes(claim), `Phase 11 notes include honest claim: ${claim}`);
  }
  assert(packageJson.files.includes("docs/external-integration-boundary.md"), "Phase 11 boundary guide is in the package surface");
}

try {
  runWorkflowReleaseContract();
  console.log("[PASS] Phase 11 version and release surface are aligned");
} catch (error) {
  console.error("[FAIL] Phase 11 release surface contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
