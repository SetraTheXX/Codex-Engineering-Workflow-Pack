"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
  writeFile,
  writeJson,
} = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function runSupervisedProposalContract() {
  const repoRoot = makeTempRepo("cewp-supervised-proposal-");

  try {
    writeFile(path.join(repoRoot, "PLAN.md"), "# Plan\n\n1. Update README safely.\n");
    writeJson(path.join(repoRoot, "proposal.json"), {
      schemaVersion: "supervised-proposal/v1",
      goal: "Apply the approved PLAN.md checkpoint",
      checkpoint: {
        title: "Update README safely",
        allowedFiles: ["README.md"],
        forbiddenFiles: ["package.json"],
        stoppingConditions: ["The targeted diff check passes"],
        verification: {
          targeted: ["git diff --check"],
          full: [],
        },
      },
      assurance: {
        profile: "critical",
        testAuthoring: "never",
      },
    });

    const result = runNode(cewpCli, [
      "supervise", "plan",
      "--proposal", "proposal.json",
      "--from", "PLAN.md",
      "--json",
    ], repoRoot);
    assert(result.status === 0, `structured proposal succeeds: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    const run = output.data.run;
    assert(run.goal === "Apply the approved PLAN.md checkpoint", "Codex proposal goal is validated into state");
    assert(run.tasks.length === 1, "Phase 9 proposal remains exactly one checkpoint");
    assert(run.tasks[0].title === "Update README safely", "checkpoint title is retained");
    assert(run.tasks[0].forbiddenFiles.includes("package.json"), "proposal forbidden scope is additive");
    assert(run.assurance.profile === "critical", "proposal assurance profile is retained");
    assert(run.assurance.testAuthoring === "never", "test-authoring policy is independent");
    assert(run.source.kind === "plan", "PLAN.md source kind is explicit");
    assert(run.source.path === "PLAN.md", "source path is repository-relative");
    assert(run.source.sha256.startsWith("sha256:"), "source identity is content-hashed");
    assert(!JSON.stringify(run).includes("Update README safely.\\n"), "raw source prose is not copied into canonical state");

    writeJson(path.join(repoRoot, "invalid-proposal.json"), {
      schemaVersion: "supervised-proposal/v1",
      goal: "Too many checkpoints",
      checkpoints: [{ id: "one" }, { id: "two" }],
    });
    const invalid = runNode(cewpCli, [
      "supervise", "plan", "--proposal", "invalid-proposal.json", "--json",
    ], repoRoot);
    assert(invalid.status === 1, "general multi-checkpoint proposal is rejected in Phase 9");
    assert(invalid.stderr.includes("exactly one checkpoint"), "proposal refusal explains the Phase 9 boundary");

    const outsidePath = path.join(path.dirname(repoRoot), "outside-plan.md");
    fs.writeFileSync(outsidePath, "outside\n");
    try {
      const outside = runNode(cewpCli, [
        "supervise", "plan",
        "--proposal", "proposal.json",
        "--from", outsidePath,
        "--json",
      ], repoRoot);
      assert(outside.status === 1, "source outside repository is rejected");
      assert(outside.stderr.includes("inside the repository"), "outside-source refusal is actionable");
    } finally {
      fs.rmSync(outsidePath, { force: true });
    }
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runSupervisedProposalContract();
  console.log("[PASS] supervised proposal intake validates bounded source-backed plans");
} catch (error) {
  console.error("[FAIL] supervised proposal contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
