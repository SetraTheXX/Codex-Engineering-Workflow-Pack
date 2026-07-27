"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");

const repoRoot = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function runContract() {
  const issueRoot = path.join(repoRoot, ".github", "ISSUE_TEMPLATE");
  const expectedForms = [
    "setup-failure.yml",
    "workflow-failure.yml",
    "feature-request.yml",
    "receipt-quality.yml",
  ];
  for (const fileName of expectedForms) {
    const content = read(path.join(".github", "ISSUE_TEMPLATE", fileName));
    assert(content.includes("name:") && content.includes("description:") && content.includes("body:"), `${fileName} is a GitHub issue form`);
    assert(/do not include secrets/i.test(content), `${fileName} warns against secrets`);
    assert(/saniti[sz]ed|redacted/i.test(content), `${fileName} requests sanitized evidence`);
    assert(!/mandatory telemetry|upload raw logs|authentication token/i.test(content), `${fileName} does not request telemetry, raw logs, or tokens`);
  }
  assert(fs.readdirSync(issueRoot).filter((name) => name.endsWith(".yml") && name !== "config.yml").sort().join("\n") === expectedForms.sort().join("\n"), "exactly four pilot feedback forms are present");
  assert(read(".github/ISSUE_TEMPLATE/setup-failure.yml").includes("cewp doctor --json"), "setup form requests actionable doctor evidence");
  assert(read(".github/ISSUE_TEMPLATE/workflow-failure.yml").includes("Expected behavior"), "workflow form distinguishes expected behavior");
  assert(read(".github/ISSUE_TEMPLATE/receipt-quality.yml").includes("observed / estimated / budgeted / unknown"), "receipt form preserves usage truth labels");

}

try {
  runContract();
  console.log("[PASS] public support issue forms");
} catch (error) {
  console.error("[FAIL] public support issue forms");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
