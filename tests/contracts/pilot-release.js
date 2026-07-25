"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");

const repoRoot = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function runContract() {
  const packageJson = JSON.parse(read("package.json"));
  const plugin = JSON.parse(read("plugins/cewp/.codex-plugin/plugin.json"));
  const version = packageJson.version.match(/^0\.(\d+)\.0-beta\.0$/);
  assert(version && Number(version[1]) >= 13, "current beta preserves the Phase 13 release surface");
  assert(plugin.version === packageJson.version, "plugin and package versions stay aligned");

  const notes = read("docs/release-notes.md");
  assert(/^## Unreleased\s+\nNo changes yet\./m.test(notes), "Unreleased is reset after release preparation");
  assert(notes.includes("## 0.13.0-beta.0"), "Phase 13 beta has versioned release notes");
  assert(/prepared locally.*not published, tagged, or released/is.test(notes), "release notes prohibit a false publication claim");
  assert(/real external.*evidence.*absent/is.test(notes), "release notes disclose missing external evidence");
  assert(/Phase 13.*exit gate.*open/is.test(notes), "release notes keep the Phase 13 exit gate open");
  assert(/ecosystem.*not.*submitted/is.test(notes), "ecosystem submission remains gated on real evidence");

  const limitations = read("docs/known-limitations.md");
  assert(/pilot infrastructure.*does not supply real participants/is.test(limitations), "limitations distinguish pilot infrastructure from users");
  assert(!limitations.includes("A general multi-checkpoint graph, dependency scheduler, automatic plan compiler, and plan migration engine are not shipped"), "known limitations no longer contradict the shipped workflow runtime");

  const readme = read("README.md");
  assert(readme.includes("cewp pilot status --json"), "README exposes the pilot status entry point");
  assert(/real external pilot evidence.*still\s+absent/is.test(readme), "README keeps product validation honest");
  assert(/1\.0.*not\s+complete/is.test(readme), "README does not imply 1.0 completion");

  for (const privateSurface of [".cewp", ".cewp-private", "phase-8-to-1.0", "docs/plans"]) {
    assert(!packageJson.files.some((entry) => entry === privateSurface || entry.startsWith(`${privateSurface}/`)), `package files exclude ${privateSurface}`);
  }
}

try {
  runContract();
  console.log("[PASS] Phase 13 beta release surface remains locally prepared and evidence-honest");
} catch (error) {
  console.error("[FAIL] Phase 13 release surface contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
