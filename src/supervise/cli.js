"use strict";

const {
  approveSupervisedRun,
  createProposedRun,
  inspectSupervisedRun,
} = require("./state");
const { executeSupervisedCheckpoint } = require("./execution");

function outputJson(command, data) {
  console.log(JSON.stringify({
    schemaVersion: "operator-json/v1",
    command,
    generatedAt: new Date().toISOString(),
    data,
    warnings: data.run.warnings || [],
  }, null, 2));
}

function printStatus(title, data) {
  console.log(title);
  console.log(`Run ID: ${data.run.runId}`);
  console.log(`Status: ${data.run.status}`);
  console.log(`Checkpoint: ${data.run.tasks[0].status}`);
  console.log(`Next: ${data.nextAction.command}`);
}

function printPlanPreview(run, runRoot) {
  const task = run.tasks[0];
  console.log("CEWP supervised run proposal");
  console.log(`Run ID: ${run.runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Goal: ${run.goal}`);
  console.log(`Checkpoint: ${task.id}`);
  console.log(`Scope: ${task.allowedFiles.join(", ")}`);
  console.log(`Stopping conditions: ${task.stoppingConditions.join("; ")}`);
  console.log(`Verification: ${task.verification.targeted.join("; ")}`);
  console.log(`Execution: ${run.execution.owner} / ${run.execution.backend}`);
  console.log(`Mode: ${run.mode}`);
  console.log(`Assurance: ${run.assurance.profile}`);
  console.log(`Test authoring: ${run.assurance.testAuthoring}`);
  console.log(`Workers: ${run.budget.maxConcurrentWorkers.value}`);
  console.log(`Repairs per checkpoint: ${run.budget.maxRepairsPerCheckpoint.value}`);
  console.log(`Model operations ceiling: ${run.budget.modelOperations.value}`);
  console.log("Estimated managed tokens: unavailable (insufficient comparable local history)");
  console.log("Host-internal usage: unknown");
  console.log("");
  console.log(`Approve: cewp supervise approve ${run.runId} --yes`);
}

function runSupervise(options = {}) {
  if (options.subcommand === "plan") {
    const result = createProposedRun({
      ...options,
      repoRoot: process.cwd(),
    });
    if (options.json) {
      outputJson("supervise.plan", result);
    } else {
      printPlanPreview(result.run, result.runRoot);
    }
    return;
  }

  if (options.subcommand === "approve") {
    const result = approveSupervisedRun({
      ...options,
      repoRoot: process.cwd(),
    });
    if (options.json) {
      outputJson("supervise.approve", result);
    } else {
      printStatus("CEWP supervised run approved", result);
    }
    return;
  }

  if (options.subcommand === "status") {
    const result = inspectSupervisedRun({
      ...options,
      repoRoot: process.cwd(),
    });
    if (options.json) {
      outputJson("supervise.status", result);
    } else {
      printStatus("CEWP supervised run status", result);
    }
    return;
  }

  if (options.subcommand === "execute") {
    const result = executeSupervisedCheckpoint({
      ...options,
      repoRoot: process.cwd(),
    });
    if (options.json) {
      outputJson("supervise.execute", result);
    } else {
      printStatus(
        result.ok ? "CEWP supervised dispatch completed" : "CEWP supervised dispatch blocked",
        result,
      );
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`Unsupported supervise command: ${options.subcommand || "(missing)"}`);
}

module.exports = {
  runSupervise,
};
