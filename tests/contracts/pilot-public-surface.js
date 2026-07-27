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

  const caseStudy = read("docs/case-study-template.md");
  for (const section of [
    "Task shape",
    "Plan and checkpoints",
    "Elapsed time and CEWP overhead",
    "Usage truth and estimate confidence",
    "Interventions and recovery",
    "Failures caught and reviewer findings",
    "Redacted receipt excerpt",
    "Limitations",
  ]) {
    assert(caseStudy.includes(`## ${section}`), `case-study template includes ${section}`);
  }
  assert(/unknown is never zero/i.test(caseStudy), "case study keeps unavailable usage unknown");
  assert(/maintainer dogfood.*does not count/i.test(caseStudy), "case study cannot disguise maintainer dogfood as external evidence");

  const pilotKit = read("docs/pilot-kit.md");
  for (const command of ["cewp pilot create", "cewp pilot record", "cewp pilot status", "cewp pilot export"]) {
    assert(pilotKit.includes(command), `pilot kit documents ${command}`);
  }
  assert(pilotKit.includes(".cewp/pilots/"), "pilot kit documents ignored canonical storage");
  assert(/maintainer technical acceptance/i.test(pilotKit), "pilot kit names the approved validation model");
  assert(/one repository attempt/i.test(pilotKit), "pilot kit documents the repository-attempt threshold");
  assert(/one full reviewed run/i.test(pilotKit), "pilot kit documents the reviewed-run threshold");
  assert(/independent user.*optional/i.test(pilotKit), "pilot kit keeps independent feedback optional without fabricating it");
}

try {
  runContract();
  console.log("[PASS] public Phase 13 pilot feedback and case-study surface");
} catch (error) {
  console.error("[FAIL] public pilot surface contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
