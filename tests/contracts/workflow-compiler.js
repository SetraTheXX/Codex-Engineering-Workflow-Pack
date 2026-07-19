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

function runWorkflowCompilerContract() {
  const repoRoot = makeTempRepo("cewp-workflow-compiler-");
  try {
    writeFile(path.join(repoRoot, "PLAN.md"), "# Release plan\n\nImplement the bounded release checks.\n");
    const result = runNode(cewpCli, [
      "workflow", "compile", "--from", "PLAN.md", "--json",
    ], repoRoot);

    assert(result.status === 0, `workflow compiler request succeeds: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert(output.command === "workflow.compile", "compiler request identifies the command");
    assert(output.data.request.schemaVersion === "workflow-compiler-request/v1", "compiler request has a stable contract");
    assert(output.data.request.source.kind === "plan", "PLAN.md source kind is inferred");
    assert(output.data.request.source.path === "PLAN.md", "compiler source path stays repository-relative");
    assert(output.data.request.source.sha256.startsWith("sha256:"), "compiler source is content-addressed");
    assert(output.data.request.prompt.includes("Implement the bounded release checks."), "agent prompt contains the source context");
    assert(output.data.request.prompt.includes("workflow-definition/v1"), "agent prompt requires the executable schema");
    assert(output.data.requestDigest.startsWith("sha256:"), "compiler request is content-addressed");
    assert(output.data.nextAction.command.includes("workflow propose --proposal"), "compiler request names the validation boundary");
    assert(output.data.nextAction.command.includes(`--compiler-digest ${output.data.requestDigest}`), "proposal command binds the compiler request");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "workflows")), "compiler request does not create canonical workflow state");

    writeJson(path.join(repoRoot, "compiler-output.json"), validDefinition());
    writeFile(path.join(repoRoot, "PLAN.md"), "# Changed plan\n\nThis changed after the compiler request.\n");
    const staleResult = runNode(cewpCli, [
      "workflow", "propose",
      "--proposal", "compiler-output.json",
      "--from", "PLAN.md",
      "--compiler-digest", output.data.requestDigest,
      "--json",
    ], repoRoot);
    assert(staleResult.status === 1, "stale compiler output is rejected after source drift");
    assert(staleResult.stderr.includes("changed since the compiler request"), "stale compiler refusal explains how to recover");
    writeFile(path.join(repoRoot, "PLAN.md"), "# Release plan\n\nImplement the bounded release checks.\n");
    const proposalResult = runNode(cewpCli, [
      "workflow", "propose",
      "--proposal", "compiler-output.json",
      "--from", "PLAN.md",
      "--compiler-digest", output.data.requestDigest,
      "--json",
    ], repoRoot);
    assert(proposalResult.status === 0, `compiler output reaches proposal validation: ${proposalResult.stderr}`);
    const proposal = JSON.parse(proposalResult.stdout).data;
    assert(proposal.compilerRequestDigest === output.data.requestDigest, "proposal preview records its compiler request");
    assert(proposal.approval.command.includes(`--compiler-digest ${output.data.requestDigest}`), "approval repeats the compiler binding");

    const directResult = runNode(cewpCli, [
      "workflow", "compile", "--goal", "Add bounded release checks", "--json",
    ], repoRoot);
    assert(directResult.status === 0, `direct goal compiler request succeeds: ${directResult.stderr}`);
    const directData = JSON.parse(directResult.stdout).data;
    const direct = directData.request;
    assert(direct.source.kind === "direct-goal" && direct.source.path === null, "direct prompt has an explicit source identity");
    assert(direct.source.sha256.startsWith("sha256:"), "direct prompt content is identified by digest");
    assert(direct.prompt.includes("Add bounded release checks"), "direct prompt reaches the agent request");
    assert(directData.nextAction.command.includes("--goal <same-direct-goal>"), "direct next action does not copy prompt text into a shell command");
    assert(directData.nextAction.command.includes(`--compiler-digest ${directData.requestDigest}`), "direct proposal binds the compiler request");
    const directProposalResult = runNode(cewpCli, [
      "workflow", "propose",
      "--proposal", "compiler-output.json",
      "--goal", "Add bounded release checks",
      "--compiler-digest", directData.requestDigest,
      "--json",
    ], repoRoot);
    assert(directProposalResult.status === 0, `direct compiler output reaches proposal validation: ${directProposalResult.stderr}`);
    const directProposal = JSON.parse(directProposalResult.stdout).data;
    assert(directProposal.source.sha256 === direct.source.sha256, "direct proposal retains the exact goal identity");
    assert(directProposal.approval.required === true, "compiler output still requires explicit operator approval");

    const sourceCases = [
      ["issue-42.md", "issue"],
      ["feature-PRD.md", "prd"],
      ["progress.md", "progress"],
    ];
    for (const [sourcePath, expectedKind] of sourceCases) {
      writeFile(path.join(repoRoot, sourcePath), `# ${expectedKind}\n\nBounded source context.\n`);
      const sourceResult = runNode(cewpCli, [
        "workflow", "compile", "--from", sourcePath, "--json",
      ], repoRoot);
      assert(sourceResult.status === 0, `${expectedKind} compiler source is accepted: ${sourceResult.stderr}`);
      const sourceData = JSON.parse(sourceResult.stdout).data;
      assert(sourceData.request.source.kind === expectedKind, `${expectedKind} compiler source kind is inferred`);
      assert(sourceData.requestDigest.startsWith("sha256:"), `${expectedKind} compiler request is content-addressed`);
    }

    const ambiguous = runNode(cewpCli, [
      "workflow", "compile", "--from", "PLAN.md", "--goal", "Conflicting goal", "--json",
    ], repoRoot);
    assert(ambiguous.status === 1, "compiler refuses ambiguous dual sources");
    assert(ambiguous.stderr.includes("exactly one source"), "ambiguous source refusal is actionable");

    const invalidDefinition = validDefinition();
    invalidDefinition.tasks[0].stoppingConditions = [];
    writeJson(path.join(repoRoot, "invalid-compiler-output.json"), invalidDefinition);
    const invalidProposal = runNode(cewpCli, [
      "workflow", "propose",
      "--proposal", "invalid-compiler-output.json",
      "--from", "PLAN.md",
      "--compiler-digest", output.data.requestDigest,
      "--json",
    ], repoRoot);
    assert(invalidProposal.status === 1, "invalid agent output never becomes a proposal");
    assert(invalidProposal.stderr.includes("stoppingConditions"), "invalid agent output names the missing gate");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "workflows")), "compiler and proposal previews remain non-mutating");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowCompilerContract();
  console.log("[PASS] workflow compiler emits a bounded agent request");
} catch (error) {
  console.error("[FAIL] workflow compiler contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
