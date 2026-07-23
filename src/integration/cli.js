"use strict";

const fs = require("node:fs");
const {
  approveCodexHookTrust,
  inspectCodexHookTrust,
  recordSubagentHookEvent,
} = require("./hook-evidence");
const { loadIntegrationControlReceipt } = require("./binding");
const { loadWorkflowRun } = require("../workflow/state");

function outputJson(command, data) {
  console.log(JSON.stringify({
    schemaVersion: "operator-json/v1",
    command,
    generatedAt: new Date().toISOString(),
    data,
    warnings: [],
  }, null, 2));
}

function runIntegration(options = {}) {
  if (options.subcommand === "controls") {
    if (!options.workflowRunId) throw new Error("integration controls requires a workflow run id.");
    const found = loadWorkflowRun(process.cwd(), options.workflowRunId);
    const result = loadIntegrationControlReceipt(found);
    if (!result) throw new Error(`Integration control receipt not found for workflow run ${options.workflowRunId}.`);
    if (options.json) outputJson("integration.controls", result);
    else {
      console.log("CEWP integration control receipt");
      console.log(`Run ID: ${result.workflow.runId}`);
      console.log(`Owner: ${result.execution.owner}`);
      console.log(`Preventive: ${result.summary.preventiveEnforced}`);
      console.log(`Post-execution: ${result.summary.postExecutionChecked}`);
      console.log(`Imported observations: ${result.summary.importedObserved}`);
      console.log(`Unavailable: ${result.summary.unavailable}`);
    }
    return;
  }
  if (options.subcommand === "hooks" && options.action === "ingest") {
    const raw = fs.readFileSync(0, "utf8");
    if (Buffer.byteLength(raw, "utf8") > 64 * 1024) {
      throw new Error("Codex hook input exceeds 65536 bytes.");
    }
    const input = JSON.parse(raw || "{}");
    recordSubagentHookEvent({ input });
    console.log("{}");
    return;
  }

  if (options.subcommand === "hooks" && options.action === "approve") {
    if (!options.workflowRunId) throw new Error("integration hooks approve requires a workflow run id.");
    const result = approveCodexHookTrust({
      repoRoot: process.cwd(),
      runId: options.workflowRunId,
      yes: options.yes,
    });
    if (options.json) outputJson("integration.hooks.approve", result);
    else {
      console.log("CEWP Codex hook evidence approved");
      console.log(`Run ID: ${result.trust.runId}`);
      console.log(`Bundle: ${result.trust.bundleDigest}`);
      console.log("Next: open /hooks and review the current definition");
    }
    return;
  }
  if (options.subcommand === "hooks" && options.action === "status") {
    if (!options.workflowRunId) throw new Error("integration hooks status requires a workflow run id.");
    const result = inspectCodexHookTrust({
      repoRoot: process.cwd(),
      runId: options.workflowRunId,
    });
    if (options.json) outputJson("integration.hooks.status", result);
    else {
      console.log("CEWP Codex hook evidence status");
      console.log(`Run ID: ${result.runId}`);
      console.log(`Active: ${result.active ? "yes" : "no"}`);
      result.warnings.forEach((warning) => console.log(`Warning: ${warning.code}: ${warning.message}`));
    }
    return;
  }
  throw new Error(`Unsupported integration command: ${options.subcommand || "missing"}.`);
}

module.exports = { runIntegration };
