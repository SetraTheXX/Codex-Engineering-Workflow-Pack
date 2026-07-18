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

function validDefinition() {
  return {
    schemaVersion: "workflow-definition/v1",
    workflowId: "docs-release",
    revision: {
      number: 1,
      parent: null,
      reason: "initial",
    },
    goal: "Update the public usage guide and its implementation example",
    tasks: [
      {
        id: "implement-example",
        title: "Implement the bounded example",
        dependsOn: [],
        allowedFiles: ["src/example.js"],
        forbiddenFiles: ["package.json"],
        stoppingConditions: ["The focused example check passes"],
        verification: {
          targeted: ["node --test tests/example.test.js"],
          full: [],
        },
        risk: "medium",
      },
      {
        id: "document-example",
        title: "Document the verified example",
        dependsOn: ["implement-example"],
        allowedFiles: ["docs/example.md"],
        forbiddenFiles: ["package.json"],
        stoppingConditions: ["The documentation check passes"],
        verification: {
          targeted: ["git diff --check"],
          full: ["npm test"],
        },
        risk: "low",
      },
    ],
    assurance: {
      profile: "standard",
      testAuthoring: "auto",
    },
    checkpointPolicy: {
      required: true,
      reviewerAfterEachTask: false,
    },
    reviewerPolicy: {
      requiredForFinalize: true,
    },
    execution: {
      owner: "managed",
      backend: "codex-exec",
      allowedModes: ["supervised"],
    },
    budget: {
      schemaVersion: "budget-envelope/v1",
      modelOperations: 12,
      allocations: {
        implementation: 6,
        repair: 2,
        completion: 1,
        reviewer: 2,
        finalization: 1,
      },
      protectedAllocations: ["completion", "reviewer", "finalization"],
      maxRepairsPerCheckpoint: 2,
      maxElapsedMinutes: 45,
      maxConcurrentWorkers: 2,
      maxCapturedOutputBytes: 1048576,
      maxTargetedVerificationRuns: 12,
      maxFullVerificationRuns: 2,
      thresholds: {
        earlyWarningPercent: 70,
        reservePercent: 90,
        absoluteCeilingPercent: 100,
      },
    },
  };
}

function runWorkflowDefinitionContract() {
  const repoRoot = makeTempRepo("cewp-workflow-definition-");
  try {
    writeJson(path.join(repoRoot, "workflow.json"), validDefinition());
    const result = runNode(cewpCli, [
      "workflow", "validate", "workflow.json", "--json",
    ], repoRoot);

    assert(result.status === 0, `workflow validation succeeds: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert(output.schemaVersion === "operator-json/v1", "workflow validation uses operator JSON");
    assert(output.command === "workflow.validate", "workflow validation identifies the command");
    assert(output.data.definition.schemaVersion === "workflow-definition/v1", "definition schema is retained");
    assert(output.data.definition.tasks.map((task) => task.id).join(",") === "implement-example,document-example", "task order is deterministic");
    assert(output.data.definition.budget.allocations.completion === 1, "completion reserve is explicit");
    assert(output.data.digest.startsWith("sha256:"), "validated definition has a content digest");

    const cyclicDefinition = validDefinition();
    cyclicDefinition.tasks[0].dependsOn = ["document-example"];
    writeJson(path.join(repoRoot, "cyclic-workflow.json"), cyclicDefinition);
    const cyclic = runNode(cewpCli, [
      "workflow", "validate", "cyclic-workflow.json", "--json",
    ], repoRoot);
    assert(cyclic.status === 1, "dependency cycle is rejected");
    assert(cyclic.stderr.includes("cycle"), "cycle refusal is actionable");
    assert(cyclic.stderr.includes("implement-example"), "cycle refusal identifies a task in the cycle");

    const missingDependency = validDefinition();
    missingDependency.tasks[1].dependsOn = ["missing-task"];
    writeJson(path.join(repoRoot, "missing-dependency.json"), missingDependency);
    const missing = runNode(cewpCli, [
      "workflow", "validate", "missing-dependency.json", "--json",
    ], repoRoot);
    assert(missing.status === 1, "missing dependency is rejected");
    assert(missing.stderr.includes("missing dependency missing-task"), "missing dependency refusal names the edge");

    const overlappingDefinition = validDefinition();
    overlappingDefinition.tasks.push({
      ...overlappingDefinition.tasks[0],
      id: "independent-overlap",
      title: "Conflicting independent work",
    });
    writeJson(path.join(repoRoot, "overlapping-workflow.json"), overlappingDefinition);
    const overlapping = runNode(cewpCli, [
      "workflow", "validate", "overlapping-workflow.json", "--json",
    ], repoRoot);
    assert(overlapping.status === 1, "independent write-scope overlap is rejected");
    assert(overlapping.stderr.includes("scope overlap"), "overlap refusal is actionable");
    assert(overlapping.stderr.includes("implement-example"), "overlap refusal names the conflicting tasks");

    const broadDefinition = validDefinition();
    broadDefinition.tasks[0].allowedFiles = Array.from(
      { length: 9 },
      (_, index) => `src/area-${index + 1}.js`,
    );
    writeJson(path.join(repoRoot, "broad-workflow.json"), broadDefinition);
    const broad = runNode(cewpCli, [
      "workflow", "validate", "broad-workflow.json", "--json",
    ], repoRoot);
    assert(broad.status === 1, "over-broad micro-goal is rejected");
    assert(broad.stderr.includes("too broad"), "broad-task refusal asks for a smaller checkpoint");
    assert(broad.stderr.includes("implement-example"), "broad-task refusal names the task");

    const vagueDefinition = validDefinition();
    vagueDefinition.tasks[0].stoppingConditions = ["done"];
    writeJson(path.join(repoRoot, "vague-workflow.json"), vagueDefinition);
    const vague = runNode(cewpCli, [
      "workflow", "validate", "vague-workflow.json", "--json",
    ], repoRoot);
    assert(vague.status === 1, "vague stopping condition is rejected");
    assert(vague.stderr.includes("vague stopping condition"), "vague refusal requests observable completion evidence");

    const unreservedDefinition = validDefinition();
    unreservedDefinition.budget.allocations.completion = 0;
    unreservedDefinition.budget.allocations.implementation += 1;
    writeJson(path.join(repoRoot, "unreserved-workflow.json"), unreservedDefinition);
    const unreserved = runNode(cewpCli, [
      "workflow", "validate", "unreserved-workflow.json", "--json",
    ], repoRoot);
    assert(unreserved.status === 1, "zero completion reserve is rejected");
    assert(unreserved.stderr.includes("completion allocation"), "reserve refusal names the missing allocation");

    const underfundedDefinition = validDefinition();
    underfundedDefinition.budget.maxTargetedVerificationRuns = 7;
    writeJson(path.join(repoRoot, "underfunded-workflow.json"), underfundedDefinition);
    const underfunded = runNode(cewpCli, [
      "workflow", "validate", "underfunded-workflow.json", "--json",
    ], repoRoot);
    assert(underfunded.status === 1, "underfunded workflow verification schedule is rejected");
    assert(underfunded.stderr.includes("targeted verification budget"), "verification refusal explains the required capacity");
  } finally {
    cleanupRepo(repoRoot);
  }
}

if (require.main === module) {
  try {
    runWorkflowDefinitionContract();
    console.log("[PASS] workflow definition validates through the public CLI");
  } catch (error) {
    console.error("[FAIL] workflow definition contract");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = {
  validDefinition,
};
