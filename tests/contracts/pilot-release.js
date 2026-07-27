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
  assert(/^## Unreleased\s*$/m.test(notes), "release notes retain an Unreleased section after beta preparation");
  assert(notes.includes("## 0.13.0-beta.0"), "Phase 13 beta has versioned release notes");
  assert(/prepared locally.*not published, tagged, or released/is.test(notes), "release notes prohibit a false publication claim");
  assert(/Phase 13.*complete.*maintainer technical acceptance/is.test(notes), "release notes record the approved Phase 13 closure");
  assert(/independent external.*not collected/is.test(notes), "release notes disclose that independent external evidence was not collected");

  const limitations = read("docs/known-limitations.md");
  assert(/independent user validation.*not performed/is.test(limitations), "limitations disclose the remaining external-validation truth");
  assert(!limitations.includes("A general multi-checkpoint graph, dependency scheduler, automatic plan compiler, and plan migration engine are not shipped"), "known limitations no longer contradict the shipped workflow runtime");

  const readme = read("README.md");
  assert(readme.includes("docs/validation-status.md"), "README links the aggregate validation boundary");
  assert(!/dogfood|pilot id|run id/i.test(readme), "README omits local acceptance-run details");

  const validation = read("docs/validation-status.md");
  assert(/technical acceptance: complete/i.test(validation), "validation status records technical acceptance");
  assert(/independent user validation: not claimed/i.test(validation), "validation status avoids an external-user claim");
  assert(/local run identifiers.*not part of\s+the public repository/is.test(validation), "validation status excludes local run identities");
  assert(packageJson.files.includes("docs/validation-status.md"), "aggregate validation status is packaged");

  for (const privateSurface of [".cewp", ".cewp-private", "docs/plans", "docs/agents"]) {
    assert(!packageJson.files.some((entry) => entry === privateSurface || entry.startsWith(`${privateSurface}/`)), `package files exclude ${privateSurface}`);
  }
}

try {
  runContract();
  console.log("[PASS] release surface is professional and evidence-honest");
} catch (error) {
  console.error("[FAIL] Phase 13 release surface contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
