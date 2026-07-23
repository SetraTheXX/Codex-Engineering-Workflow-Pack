"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomic } = require("../workflow/state");
const { buildEvidenceReceipt } = require("./receipt");

const OPERATOR_REPORT_SCHEMA_VERSION = "operator-report/v1";
const ACTIVE_TASK_STATUSES = new Set(["running", "verifying", "review-pending"]);

function remainingAllocation(entry) {
  return Math.max(0, entry.approved - entry.consumed);
}

function groupControls(receipt) {
  const controls = receipt.policy.controls && Array.isArray(receipt.policy.controls.controls)
    ? receipt.policy.controls.controls
    : [];
  return {
    enforced: controls.filter((entry) => entry.classification === "preventive"),
    checked: controls.filter((entry) => entry.classification === "post-execution"),
    observed: controls.filter((entry) => entry.classification === "imported"),
    unavailable: controls.filter((entry) => entry.classification === "unavailable"),
    claims: receipt.policy.controls ? receipt.policy.controls.claims : {
      observedEvidenceIsPreventiveEnforcement: false,
      providerExecutionSuppliesEnforcement: false,
      preventiveControlAuthority: "none",
      guardrailAuthority: "cewp-core-outside-provider-execution",
    },
  };
}

function buildOperatorReport(receipt) {
  if (!receipt || receipt.schemaVersion !== "evidence-receipt/v1") {
    throw new Error("Operator report requires evidence-receipt/v1.");
  }
  const allocationEntries = receipt.budget.compliance.allocations;
  const completedTasks = receipt.tasks.filter((task) => task.status === "completed").length;
  const activeTasks = receipt.tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length;
  return {
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    generatedAt: receipt.generatedAt,
    runId: receipt.runId,
    goal: receipt.goal,
    completeness: receipt.completeness,
    execution: receipt.execution,
    progress: {
      runStatus: receipt.completeness.runStatus,
      totalTasks: receipt.tasks.length,
      completedTasks,
      activeTasks,
      remainingTasks: receipt.tasks.length - completedTasks,
    },
    planRevisions: receipt.planRevisions,
    tasks: receipt.tasks,
    checkpoints: receipt.checkpoints,
    interventions: receipt.interventions,
    values: {
      observed: receipt.usage,
      estimated: receipt.estimate,
      budgeted: receipt.budget,
      apiEquivalentCost: receipt.cost.apiEquivalent,
    },
    reserves: {
      absoluteCeilingRespected: receipt.budget.compliance.absoluteCeilingRespected,
      protectedAllocationsRespected: receipt.budget.compliance.protectedAllocationsRespected,
      allocations: allocationEntries.map((entry) => ({ ...entry, remaining: remainingAllocation(entry) })),
    },
    pauseAndRecovery: {
      pauseReason: receipt.budget.pauseReason,
      resumeStatus: receipt.budget.resumeStatus,
      thresholdEvents: receipt.budget.thresholdEvents,
      interventions: receipt.interventions,
      failures: receipt.tasks.flatMap((task) => task.failure ? [{ taskId: task.id, ...task.failure }] : []),
    },
    controls: groupControls(receipt),
    finalReview: receipt.reviewer,
    reviews: receipt.reviews,
    warnings: receipt.warnings,
    integrity: {
      claim: receipt.integrity.claim,
      tamperProof: receipt.integrity.tamperProof,
      fileCount: receipt.integrity.files.length,
    },
  };
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "unknown" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truthText(value) {
  if (!value || value.label === "unknown") return "unknown";
  return `${value.label}: ${value.value}`;
}

function list(items, render, empty = "None") {
  return items.length > 0
    ? `<ul>${items.map((item) => `<li>${render(item)}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(empty)}</p>`;
}

function renderOperatorReportHtml(report) {
  if (!report || report.schemaVersion !== OPERATOR_REPORT_SCHEMA_VERSION) {
    throw new Error(`Operator HTML requires ${OPERATOR_REPORT_SCHEMA_VERSION}.`);
  }
  const allocationRows = report.reserves.allocations.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td>${entry.approved}</td><td>${entry.consumed}</td><td>${entry.remaining}</td><td>${entry.protected ? "yes" : "no"}</td><td>${entry.respected ? "passed" : "failed"}</td></tr>`).join("");
  const taskRows = report.tasks.map((task) => `<tr><td>${escapeHtml(task.id)}</td><td>${escapeHtml(task.status)}</td><td>${task.attempts}</td><td>${escapeHtml(task.scopeVerdict.status)}</td><td>${escapeHtml(task.changedFiles.join(", ") || "none")}</td></tr>`).join("");
  const controlItems = (label, entries) => `<h3>${label}</h3>${list(entries, (entry) => `${escapeHtml(entry.name)} (${escapeHtml(entry.effect)})`)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CEWP Operator Report - ${escapeHtml(report.runId)}</title>
<style>body{font:15px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#17202a;background:#fff}h1,h2{color:#123b5d}section{border-top:1px solid #ccd6dd;padding:1rem 0}table{border-collapse:collapse;width:100%}th,td{text-align:left;border:1px solid #ccd6dd;padding:.45rem;vertical-align:top}.truth{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.75rem}.card{border:1px solid #ccd6dd;border-radius:6px;padding:.75rem}.failed{color:#9b1c1c}.unknown{color:#6b4f00}</style>
</head>
<body>
<h1>CEWP Operator Report</h1>
<p><strong>Run:</strong> ${escapeHtml(report.runId)}<br><strong>Goal:</strong> ${escapeHtml(report.goal)}<br><strong>Status:</strong> ${escapeHtml(report.progress.runStatus)} (${escapeHtml(report.completeness.status)})<br><strong>Execution:</strong> ${escapeHtml(report.execution.owner)} / ${escapeHtml(report.execution.backend)}</p>
<section><h2>Progress</h2><div class="truth"><div class="card">Tasks: ${report.progress.completedTasks}/${report.progress.totalTasks} complete</div><div class="card">Active: ${report.progress.activeTasks}</div><div class="card">Remaining: ${report.progress.remainingTasks}</div></div><table><thead><tr><th>Task</th><th>Status</th><th>Attempts</th><th>Scope</th><th>Changed files</th></tr></thead><tbody>${taskRows}</tbody></table></section>
<section><h2>Plan revisions</h2>${list(report.planRevisions, (entry) => `Revision ${escapeHtml(entry.revision)}: ${escapeHtml(entry.reason || entry.digest)}`)}</section>
<section><h2>Checkpoint evidence</h2>${list(report.checkpoints, (entry) => `${escapeHtml(entry.checkpointId)}: ${escapeHtml(entry.status)}; task ${escapeHtml(entry.taskId)}; baseline ${escapeHtml(entry.verification && entry.verification.baseline && entry.verification.baseline.status)}`)}</section>
<section><h2>Interventions and recovery</h2>${list(report.interventions, (entry) => `${escapeHtml(entry.event)}: ${escapeHtml(entry.reason)}`)}<p>Pause: ${escapeHtml(report.pauseAndRecovery.pauseReason)}; resume state: ${escapeHtml(report.pauseAndRecovery.resumeStatus)}</p></section>
<section><h2>Observed, estimated, budgeted, and unknown</h2><div class="truth"><div class="card">Observed managed operations: ${escapeHtml(truthText(report.values.observed.managedOperations))}</div><div class="card">Observed host usage: ${escapeHtml(truthText(report.values.observed.hostInternal))}</div><div class="card">Estimate: ${escapeHtml(report.values.estimated.label)} (${escapeHtml(report.values.estimated.confidence)})</div><div class="card">API-equivalent cost: ${escapeHtml(report.values.apiEquivalentCost.label)}</div></div></section>
<section><h2>Protected reserves</h2><p>Absolute ceiling: ${report.reserves.absoluteCeilingRespected ? "passed" : "failed"}; protected allocations: ${report.reserves.protectedAllocationsRespected ? "passed" : "failed"}</p><table><thead><tr><th>Allocation</th><th>Approved</th><th>Consumed</th><th>Remaining</th><th>Protected</th><th>Verdict</th></tr></thead><tbody>${allocationRows}</tbody></table></section>
<section><h2>Controls</h2>${controlItems("Preventively enforced", report.controls.enforced)}${controlItems("Post-execution checked", report.controls.checked)}${controlItems("Observed, not enforced", report.controls.observed)}${controlItems("Unavailable", report.controls.unavailable)}</section>
<section><h2>Final review</h2><p>Status: ${escapeHtml(report.finalReview.status)}; decision: ${escapeHtml(report.finalReview.decision)}</p></section>
<section><h2>Warnings</h2>${list(report.warnings, (entry) => `${escapeHtml(entry.code)}: ${escapeHtml(entry.message)}`)}</section>
<footer><p>Generated ${escapeHtml(report.generatedAt)}. Integrity: ${escapeHtml(report.integrity.claim)}; not tamper-proof. This offline report excludes raw prompts and logs.</p></footer>
</body>
</html>
`;
}

function writeTextAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, content, { flag: "wx" });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function writeOperatorReport(found, options = {}) {
  const receipt = buildEvidenceReceipt(found, options);
  const report = buildOperatorReport(receipt);
  const jsonPath = path.join(found.runRoot, "operator-report.json");
  const htmlPath = path.join(found.runRoot, "operator-report.html");
  writeJsonAtomic(jsonPath, report);
  writeTextAtomic(htmlPath, renderOperatorReportHtml(report));
  return { report, paths: { json: jsonPath, html: htmlPath } };
}

module.exports = {
  OPERATOR_REPORT_SCHEMA_VERSION,
  buildOperatorReport,
  renderOperatorReportHtml,
  writeOperatorReport,
};
