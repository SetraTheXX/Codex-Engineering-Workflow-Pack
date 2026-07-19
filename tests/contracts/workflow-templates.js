"use strict";

const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
  writeJson,
} = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");
const templateNames = ["guarded-change", "migration", "review-only"];

function runWorkflowTemplateContract() {
  const repoRoot = makeTempRepo("cewp-workflow-templates-");
  try {
    const listedResult = runNode(cewpCli, [
      "workflow", "template", "list", "--json",
    ], repoRoot);
    assert(listedResult.status === 0, `workflow templates list: ${listedResult.stderr}`);
    const listed = JSON.parse(listedResult.stdout);
    assert(listed.command === "workflow.template", "template list identifies the command");
    assert(listed.data.templates.map((entry) => entry.name).join(",") === templateNames.join(","), "only the three approved templates ship");

    for (const name of templateNames) {
      const shownResult = runNode(cewpCli, [
        "workflow", "template", name, "--json",
      ], repoRoot);
      assert(shownResult.status === 0, `${name} template renders: ${shownResult.stderr}`);
      const shown = JSON.parse(shownResult.stdout);
      assert(shown.command === "workflow.template", `${name} output identifies the command`);
      assert(shown.data.name === name, `${name} preserves its stable name`);
      assert(shown.data.definition.schemaVersion === "workflow-definition/v1", `${name} uses the workflow definition contract`);
      assert(shown.data.digest.startsWith("sha256:"), `${name} has a normalized definition digest`);
      writeJson(path.join(repoRoot, `${name}.json`), shown.data.definition);
      const validated = runNode(cewpCli, [
        "workflow", "validate", `${name}.json`, "--json",
      ], repoRoot);
      assert(validated.status === 0, `${name} passes the public validator: ${validated.stderr}`);
      assert(JSON.parse(validated.stdout).data.digest === shown.data.digest, `${name} digest is validator-stable`);
    }

    const guarded = JSON.parse(runNode(cewpCli, [
      "workflow", "template", "guarded-change", "--json",
    ], repoRoot).stdout).data.definition;
    assert(guarded.tasks[0].stoppingConditions.length > 0, "guarded change has an observable stop condition");
    assert(guarded.tasks[0].verification.targeted.length > 0, "guarded change requires focused verification");
    const migration = JSON.parse(runNode(cewpCli, [
      "workflow", "template", "migration", "--json",
    ], repoRoot).stdout).data.definition;
    assert(migration.tasks.length === 2 && migration.tasks[1].dependsOn[0] === migration.tasks[0].id, "migration separates preparation from guarded application");
    assert(migration.tasks.some((task) => task.stoppingConditions.some((condition) => /backup|rollback/i.test(condition))), "migration exposes a recovery condition");
    const reviewOnly = JSON.parse(runNode(cewpCli, [
      "workflow", "template", "review-only", "--json",
    ], repoRoot).stdout).data.definition;
    assert(reviewOnly.execution.owner === "audit-only" && reviewOnly.execution.backend === null, "review-only never claims managed execution ownership");

    const unknown = runNode(cewpCli, [
      "workflow", "template", "feature-factory", "--json",
    ], repoRoot);
    assert(unknown.status === 1, "unapproved template name is rejected");
    assert(unknown.stderr.includes(templateNames.join(", ")), "template refusal lists the supported set");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowTemplateContract();
  console.log("[PASS] workflow templates stay minimal and schema-valid");
} catch (error) {
  console.error("[FAIL] workflow template contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
