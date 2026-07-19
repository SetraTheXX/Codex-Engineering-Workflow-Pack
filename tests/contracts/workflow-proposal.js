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
const { validDefinition } = require("./workflow-definition");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function runWorkflowProposalContract() {
  const repoRoot = makeTempRepo("cewp-workflow-proposal-");
  try {
    writeFile(path.join(repoRoot, "PLAN.md"), "# Release plan\n\nThis prose is source context, not executable state.\n");
    writeJson(path.join(repoRoot, "proposal.json"), validDefinition());

    const proseOnly = runNode(cewpCli, [
      "workflow", "propose", "--from", "PLAN.md", "--json",
    ], repoRoot);
    assert(proseOnly.status === 1, "raw prose cannot be proposed without structured JSON");
    assert(proseOnly.stderr.includes("prose is not executable truth"), "raw prose refusal explains the trust boundary");

    const result = runNode(cewpCli, [
      "workflow", "propose",
      "--proposal", "proposal.json",
      "--from", "PLAN.md",
      "--json",
    ], repoRoot);
    assert(result.status === 0, `workflow proposal succeeds: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert(output.command === "workflow.propose", "proposal output identifies the command");
    assert(output.data.definition.schemaVersion === "workflow-definition/v1", "proposal contains a normalized definition");
    assert(output.data.definitionDigest.startsWith("sha256:"), "proposal separates the immutable definition digest");
    assert(output.data.source.kind === "plan", "PLAN.md source kind is inferred");
    assert(output.data.source.path === "PLAN.md", "source path stays repository-relative");
    assert(output.data.source.sha256.startsWith("sha256:"), "source content is identified by digest");
    assert(output.data.diff.addedTasks.join(",") === "implement-example,document-example", "initial proposal shows added tasks");
    assert(output.data.approval.required === true, "proposal requires explicit approval");
    assert(output.data.approval.command.includes("workflow approve"), "proposal explains the approval command");
    assert(output.data.approval.command.includes(output.data.digest), "approval command binds the proposed digest");
    assert(!JSON.stringify(output.data.definition).includes("source context"), "source prose is not copied into executable state");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "workflows")), "proposal preview creates no canonical workflow state");

    const unconfirmed = runNode(cewpCli, [
      "workflow", "approve",
      "--proposal", "proposal.json",
      "--from", "PLAN.md",
      "--digest", output.data.digest,
      "--json",
    ], repoRoot);
    assert(unconfirmed.status === 1, "workflow approval requires --yes");
    assert(unconfirmed.stderr.includes("--yes"), "approval refusal explains explicit confirmation");

    const changedDefinition = validDefinition();
    changedDefinition.goal = "Changed after preview";
    writeJson(path.join(repoRoot, "proposal.json"), changedDefinition);
    const staleApproval = runNode(cewpCli, [
      "workflow", "approve",
      "--proposal", "proposal.json",
      "--from", "PLAN.md",
      "--digest", output.data.digest,
      "--yes",
      "--json",
    ], repoRoot);
    assert(staleApproval.status === 1, "changed proposal cannot use a stale approval digest");
    assert(staleApproval.stderr.includes("changed after preview"), "stale approval refusal requests a new preview");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "workflows")), "stale approval creates no definition state");
    writeJson(path.join(repoRoot, "proposal.json"), validDefinition());

    writeFile(path.join(repoRoot, "PLAN.md"), "# Changed release plan\n\nThe source changed after preview.\n");
    const staleSource = runNode(cewpCli, [
      "workflow", "approve",
      "--proposal", "proposal.json",
      "--from", "PLAN.md",
      "--digest", output.data.digest,
      "--yes",
      "--json",
    ], repoRoot);
    assert(staleSource.status === 1, "changed source cannot use a stale approval digest");
    assert(staleSource.stderr.includes("source or proposal changed after preview"), "stale source refusal requests a fresh proposal preview");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "workflows")), "stale source approval creates no definition state");
    writeFile(path.join(repoRoot, "PLAN.md"), "# Release plan\n\nThis prose is source context, not executable state.\n");

    const approvedResult = runNode(cewpCli, [
      "workflow", "approve",
      "--proposal", "proposal.json",
      "--from", "PLAN.md",
      "--digest", output.data.digest,
      "--yes",
      "--json",
    ], repoRoot);
    assert(approvedResult.status === 0, `workflow approval succeeds: ${approvedResult.stderr}`);
    const approved = JSON.parse(approvedResult.stdout);
    assert(approved.command === "workflow.approve", "approval output identifies the command");
    assert(approved.data.run.schemaVersion === "run-state/v2", "approval creates the Phase 10 run state");
    assert(approved.data.run.status === "approved", "approval does not dispatch work");
    assert(approved.data.run.tasks.find((task) => task.id === "implement-example").status === "ready", "root task becomes ready");
    assert(approved.data.run.tasks.find((task) => task.id === "document-example").status === "pending", "dependent task waits");
    assert(approved.data.run.approval.digest === output.data.digest, "canonical approval records the reviewed digest");
    assert(approved.data.run.workflow.digest === output.data.definitionDigest, "run keeps the definition digest distinct from approval context");
    assert(fs.existsSync(path.join(repoRoot, approved.data.definitionPath)), "approved definition is persisted");
    assert(fs.existsSync(path.join(repoRoot, approved.data.runPath)), "run state is persisted");

    const sourceCases = [
      ["issue-42.md", "issue"],
      ["feature-PRD.md", "prd"],
      ["progress.md", "progress"],
    ];
    for (const [sourcePath, expectedKind] of sourceCases) {
      writeFile(path.join(repoRoot, sourcePath), `# ${expectedKind}\n`);
      const sourceResult = runNode(cewpCli, [
        "workflow", "propose", "--proposal", "proposal.json", "--from", sourcePath, "--json",
      ], repoRoot);
      assert(sourceResult.status === 0, `${expectedKind} proposal source is accepted`);
      assert(JSON.parse(sourceResult.stdout).data.source.kind === expectedKind, `${expectedKind} source kind is inferred`);
    }
    const directResult = runNode(cewpCli, [
      "workflow", "propose", "--proposal", "proposal.json", "--json",
    ], repoRoot);
    assert(directResult.status === 0, "direct goal proposal is accepted");
    assert(JSON.parse(directResult.stdout).data.source.kind === "direct-goal", "direct goal source stays explicit");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowProposalContract();
  console.log("[PASS] workflow proposal is validated and previewed without mutation");
} catch (error) {
  console.error("[FAIL] workflow proposal contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
