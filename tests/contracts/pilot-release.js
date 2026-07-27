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
  assert(readme.includes("cewp pilot status --json"), "README exposes the pilot status entry point");
  assert(/Phase 13.*complete.*maintainer technical acceptance/is.test(readme), "README publishes the approved Phase 13 state");
  assert(/independent user validation.*not required/i.test(readme), "README distinguishes optional external feedback from completion");

  const acceptance = JSON.parse(read("docs/phase-13-maintainer-acceptance.json"));
  assert(acceptance.schemaVersion === "phase-13-maintainer-acceptance/v1", "Phase 13 closure evidence is versioned");
  assert(acceptance.status === "complete" && acceptance.phase === 13, "Phase 13 closure evidence is explicit");
  assert(acceptance.validationModel === "maintainer-technical-acceptance", "closure evidence names the validation model");
  assert(acceptance.independentUserValidation.required === false && acceptance.independentUserValidation.collected === false, "closure evidence does not fabricate independent users");
  assert(acceptance.evidence.reviewerDecision === "PASS" && acceptance.evidence.verification === "PASS", "closure evidence records reviewer and verification results");
  assert(acceptance.evidence.receipt === "complete" && acceptance.evidence.finalized === true, "closure evidence records receipt and finalize completion");
  assert(acceptance.evidence.pilotStatus === "complete" && acceptance.evidence.pilotExport === "PASS", "closure evidence records pilot status and export");
  assert(packageJson.files.includes("docs/phase-13-maintainer-acceptance.json"), "machine-readable closure evidence is packaged");
  assert(packageJson.files.includes("docs/phase-13-maintainer-acceptance.md"), "Turkish closure report is packaged");

  for (const privateSurface of [".cewp", ".cewp-private", "phase-8-to-1.0", "docs/plans"]) {
    assert(!packageJson.files.some((entry) => entry === privateSurface || entry.startsWith(`${privateSurface}/`)), `package files exclude ${privateSurface}`);
  }
}

try {
  runContract();
  console.log("[PASS] Phase 13 maintainer technical acceptance is complete and evidence-honest");
} catch (error) {
  console.error("[FAIL] Phase 13 release surface contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
