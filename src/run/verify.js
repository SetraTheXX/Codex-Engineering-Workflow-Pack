"use strict";

const { verifyWorkflowRun } = require("../evidence/verify");

function runVerify(options = {}) {
  if (!options.runId) throw new Error("run verify requires a workflow run id.");
  const report = verifyWorkflowRun(process.cwd(), options.runId);
  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: "operator-json/v1", command: "run.verify", data: report }, null, 2));
  } else {
    console.log("CEWP run verification");
    console.log(`Run ID: ${report.runId}`);
    console.log(`Status: ${report.status}`);
    for (const entry of report.checks) console.log(`${entry.id}: ${entry.status}`);
    for (const entry of report.issues) console.log(`[${entry.code}] ${entry.message}`);
  }
  if (report.status !== "passed") process.exitCode = 1;
  return report;
}

module.exports = { runVerify };
