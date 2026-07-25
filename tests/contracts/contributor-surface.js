"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");

const repoRoot = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function runContract() {
  const contributing = read("CONTRIBUTING.md");
  for (const requirement of [
    "npm run test:pilot-record",
    "npm run check",
    "git diff --check",
    "good first issue",
    "phase-8-to-1.0",
    ".cewp-private",
    "provider expansion",
  ]) {
    assert(contributing.toLowerCase().includes(requirement.toLowerCase()), `contribution guide includes ${requirement}`);
  }
  assert(/do not commit.*\.cewp\/pilots/is.test(contributing), "contribution guide keeps pilot records private");
  assert(/red.*green.*refactor/is.test(contributing), "contribution guide documents the TDD loop");

  const security = read("SECURITY.md");
  assert(security.includes("security/advisories/new"), "security reports use a private advisory path");
  assert(/do not.*public issue/is.test(security), "security guide refuses public vulnerability details");
  for (const surface of ["path containment", "MCP", "hook trust", "redaction", "worktree ownership", "imported evidence"]) {
    assert(security.toLowerCase().includes(surface.toLowerCase()), `security guide names ${surface}`);
  }

  const architecture = read("docs/architecture.md");
  assert(/CEWP Core.*authoritative/is.test(architecture), "architecture keeps Core authoritative");
  assert(/one execution owner.*one managed backend/is.test(architecture), "architecture keeps ownership singular");
  for (const layer of ["Host surface", "Codex plugin", "CEWP Core", "Execution bridge", "Evidence and pilot"] ) {
    assert(architecture.includes(layer), `architecture maps ${layer}`);
  }
  assert(/provider-specific identities.*outside.*workflow schema/is.test(architecture), "architecture keeps provider ids outside neutral schemas");

  const extension = read("docs/contract-extension-example.md");
  for (const requirement of ["schemaVersion", "provider-neutral", "fail closed", "read compatibility", "focused contract test"]) {
    assert(extension.includes(requirement), `contract extension guide includes ${requirement}`);
  }

  const readme = read("README.md");
  for (const link of ["CONTRIBUTING.md", "SECURITY.md", "docs/architecture.md", "docs/contract-extension-example.md"]) {
    assert(readme.includes(link), `README links ${link}`);
  }
  const packageJson = JSON.parse(read("package.json"));
  for (const publicFile of ["CONTRIBUTING.md", "SECURITY.md", "docs/architecture.md", "docs/contract-extension-example.md"]) {
    assert(packageJson.files.includes(publicFile), `package includes reviewed public file ${publicFile}`);
  }
}

try {
  runContract();
  console.log("[PASS] contributor, architecture, contract, and security surfaces");
} catch (error) {
  console.error("[FAIL] contributor surface contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
