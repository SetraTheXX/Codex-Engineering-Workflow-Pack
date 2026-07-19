"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  readJson,
  runNode,
  writeJson,
} = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function runWorkflowProgressContract() {
  const repoRoot = makeTempRepo("cewp-workflow-progress-");
  try {
    const run = approveWorkflow(repoRoot, validDefinition());
    const runRoot = path.join(repoRoot, ".cewp", "workflow-runs", run.runId);
    const progressPath = path.join(runRoot, "progress.json");
    const markdownPath = path.join(runRoot, "progress.md");
    assert(fs.existsSync(progressPath), "approval creates machine-readable progress");
    assert(fs.existsSync(markdownPath), "approval creates Markdown progress");

    const progress = readJson(progressPath);
    assert(progress.schemaVersion === "progress-view/v1", "progress contract is versioned");
    assert(progress.summary.completed === 0 && progress.summary.total === 2, "initial progress is derived from tasks");
    assert(progress.tasks[0].status === "ready", "root task is ready in progress");
    assert(progress.nextAction.command.includes("workflow start"), "progress shows the next safe command");

    fs.writeFileSync(markdownPath, "# Forged\n\nStatus: completed\n");
    const statusResult = runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot);
    assert(statusResult.status === 0, `status regenerates progress: ${statusResult.stderr}`);
    const status = JSON.parse(statusResult.stdout);
    assert(status.data.progress.schemaVersion === "progress-view/v1", "status returns derived progress");
    assert(!fs.readFileSync(markdownPath, "utf8").includes("# Forged"), "forged Markdown is overwritten");
    assert(status.data.progress.status === "approved", "presentation edits cannot change run status");

    const runPath = path.join(runRoot, "run.json");
    const forgedRun = readJson(runPath);
    forgedRun.tasks[0].status = "completed";
    forgedRun.tasks[0].resultId = null;
    forgedRun.tasks[0].verification = null;
    writeJson(runPath, forgedRun);
    const invalid = runNode(cewpCli, [
      "workflow", "status", run.runId, "--json",
    ], repoRoot);
    assert(invalid.status === 1, "canonical completed claim without evidence is rejected");
    assert(invalid.stderr.includes("claims completed without"), "invalid completion refusal names missing evidence");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowProgressContract();
  console.log("[PASS] workflow progress is derived and evidence-gated");
} catch (error) {
  console.error("[FAIL] workflow progress contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
