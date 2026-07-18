"use strict";

const {
  digestWorkflowDefinition,
  validateWorkflowDefinition,
} = require("./definition");
const { makeSourceIdentity, readRepoJson } = require("./source");
const { createApprovedRun, loadWorkflowRun, startWorkflowTask } = require("./state");
const { deriveSchedule } = require("./scheduler");

function outputJson(command, data) {
  console.log(JSON.stringify({
    schemaVersion: "operator-json/v1",
    command,
    generatedAt: new Date().toISOString(),
    data,
    warnings: [],
  }, null, 2));
}

function runWorkflow(options = {}) {
  if (options.subcommand === "validate") {
    if (!options.definitionFile) {
      throw new Error("workflow validate requires a repository-relative JSON file.");
    }
    const file = readRepoJson(process.cwd(), options.definitionFile, "workflow definition");
    const definition = validateWorkflowDefinition(file.value);
    const digest = digestWorkflowDefinition(definition);
    const result = {
      definition,
      digest,
    };
    if (options.json) {
      outputJson("workflow.validate", result);
    } else {
      console.log("CEWP workflow definition valid");
      console.log(`Workflow: ${definition.workflowId}`);
      console.log(`Revision: ${definition.revision.number}`);
      console.log(`Tasks: ${definition.tasks.length}`);
      console.log(`Digest: ${result.digest}`);
    }
    return;
  }

  if (options.subcommand === "propose") {
    if (!options.proposalFile) {
      throw new Error("workflow propose requires --proposal with structured JSON; prose is not executable truth.");
    }
    const file = readRepoJson(process.cwd(), options.proposalFile, "workflow proposal");
    const definition = validateWorkflowDefinition(file.value);
    const digest = digestWorkflowDefinition(definition);
    const source = makeSourceIdentity(process.cwd(), options.fromFile, options.sourceKind);
    const fromOption = options.fromFile ? ` --from ${options.fromFile}` : "";
    const result = {
      definition,
      digest,
      source,
      diff: {
        baseRevision: null,
        proposedRevision: definition.revision.number,
        goalChanged: true,
        budgetChanged: true,
        addedTasks: definition.tasks.map((task) => task.id),
        removedTasks: [],
        changedTasks: [],
      },
      approval: {
        required: true,
        command: `cewp workflow approve --proposal ${options.proposalFile}${fromOption} --digest ${digest} --yes`,
      },
    };
    if (options.json) outputJson("workflow.propose", result);
    else {
      console.log("CEWP workflow proposal");
      console.log(`Workflow: ${definition.workflowId}`);
      console.log(`Tasks added: ${result.diff.addedTasks.join(", ")}`);
      console.log(`Approve: ${result.approval.command}`);
    }
    return;
  }

  if (options.subcommand === "approve") {
    if (!options.yes) throw new Error("Explicit workflow approval requires --yes after previewing the proposal.");
    if (!options.proposalFile) throw new Error("workflow approve requires --proposal.");
    if (!options.digest) throw new Error("workflow approve requires the --digest shown by workflow propose.");
    const file = readRepoJson(process.cwd(), options.proposalFile, "workflow proposal");
    const definition = validateWorkflowDefinition(file.value);
    const source = makeSourceIdentity(process.cwd(), options.fromFile, options.sourceKind);
    const result = createApprovedRun({
      repoRoot: process.cwd(),
      definition,
      source,
      expectedDigest: options.digest,
    });
    if (options.json) outputJson("workflow.approve", result);
    else {
      console.log("CEWP workflow approved");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Ready tasks: ${result.run.tasks.filter((task) => task.status === "ready").map((task) => task.id).join(", ")}`);
    }
    return;
  }

  if (options.subcommand === "status") {
    if (!options.workflowRunId) throw new Error("workflow status requires a run id.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const schedule = deriveSchedule(found.run, found.definition);
    const result = { run: found.run, ...schedule };
    if (options.json) outputJson("workflow.status", result);
    else {
      console.log("CEWP workflow status");
      console.log(`Run ID: ${found.run.runId}`);
      console.log(`Status: ${found.run.status}`);
      console.log(`Ready: ${schedule.readyTasks.map((task) => task.id).join(", ") || "none"}`);
      console.log(`Worker capacity: ${schedule.capacity.available}/${schedule.capacity.maximum}`);
    }
    return;
  }

  if (options.subcommand === "start") {
    if (!options.yes) throw new Error("Starting a workflow task requires --yes.");
    if (!options.workflowRunId) throw new Error("workflow start requires a run id.");
    if (!options.taskId) throw new Error("workflow start requires --task.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const result = startWorkflowTask(found, options.taskId);
    if (options.json) outputJson("workflow.start", result);
    else {
      console.log("CEWP workflow task started");
      console.log(`Run ID: ${result.run.runId}`);
      console.log(`Task: ${result.checkpoint.taskId}`);
      console.log(`Checkpoint: ${result.checkpoint.checkpointId}`);
    }
    return;
  }

  throw new Error(`Unsupported workflow command: ${options.subcommand || "missing"}.`);
}

module.exports = {
  runWorkflow,
};
