"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode, writeFile } = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const { loadWorkflowRun, startWorkflowTask } = require("../../src/workflow/state");
const { buildEvidenceReceipt } = require("../../src/evidence/receipt");
const {
  buildOperatorReport,
  renderOperatorReportHtml,
  writeOperatorReport,
} = require("../../src/evidence/report");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function runContract() {
  const repoRoot = makeTempRepo("cewp-operator-report-");
  try {
    const definition = validDefinition();
    definition.goal = "Audit <script>alert('unsafe')</script> safely";
    const approved = approveWorkflow(repoRoot, definition);
    let found = loadWorkflowRun(repoRoot, approved.runId);
    startWorkflowTask(found, "implement-example", {
      now: new Date(new Date(found.run.createdAt).getTime() + 1000),
    });
    found = loadWorkflowRun(repoRoot, approved.runId);
    writeFile(path.join(found.runRoot, "adapter-output", "prompt.md"), "REPORT_SECRET_PROMPT\n");
    const generatedAt = "2026-07-22T12:00:00.000Z";
    const receipt = buildEvidenceReceipt(found, { generatedAt });
    const first = buildOperatorReport(receipt);
    const second = buildOperatorReport(receipt);
    assert(first.schemaVersion === "operator-report/v1", "operator report is versioned");
    assert(JSON.stringify(first) === JSON.stringify(second), "operator report model is deterministic for one receipt");
    assert(first.progress.totalTasks === 2 && first.progress.activeTasks === 1, "report derives task progress");
    assert(Array.isArray(first.planRevisions) && Array.isArray(first.checkpoints), "report exposes revision and checkpoint evidence");
    assert(first.checkpoints[0].verification.baseline.status === "pending", "checkpoint verification evidence is preserved in the report model");
    assert(first.values.observed.managedOperations.label === "unknown", "report preserves observed-versus-unknown truth");
    assert(first.values.estimated.schemaVersion === "usage-estimate/v1", "report exposes estimates separately");
    assert(first.values.budgeted.compliance.status === "passed", "report exposes budget compliance");
    assert(first.reserves.allocations.some((entry) => entry.protected), "report identifies protected reserves");
    assert(first.controls.enforced.length === 0 && first.controls.observed.length === 0, "absent controls are not invented");
    assert(first.finalReview.status === "pending", "report presents final-review state without claiming PASS");

    const html = renderOperatorReportHtml(first);
    assert(html.includes("<!doctype html>") && html.includes("Content-Security-Policy"), "report is standalone HTML with an offline policy");
    assert(!html.includes("<script>alert('unsafe')</script>"), "goal content is HTML escaped");
    assert(html.includes("&lt;script&gt;alert(&#39;unsafe&#39;)&lt;/script&gt;"), "escaped goal remains understandable");
    assert(!/https?:\/\//.test(html), "report has no network dependency");
    assert(!html.includes("REPORT_SECRET_PROMPT"), "report excludes raw prompt content");
    assert(html.includes("Protected reserves") && html.includes("Final review"), "offline report includes critical operator sections");

    const written = writeOperatorReport(found, { generatedAt });
    assert(fs.existsSync(written.paths.json) && fs.existsSync(written.paths.html), "operator JSON and HTML are written locally");
    const cli = runNode(cewpCli, ["workflow", "report", approved.runId, "--json"], repoRoot);
    assert(cli.status === 0, `workflow report CLI succeeds: ${cli.stderr}`);
    const output = JSON.parse(cli.stdout);
    assert(output.command === "workflow.report" && output.data.report.schemaVersion === "operator-report/v1", "CLI returns the shared report model");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] static offline operator report");
} catch (error) {
  console.error("[FAIL] operator report contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
