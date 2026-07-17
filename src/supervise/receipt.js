"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonFile } = require("../lib/json");
const { getWorktreeChangeSummary, findScopeWarnings } = require("../lib/scope-check");
const { assertPolicyAllows } = require("../run/policy");
const { validateOwnershipRecord } = require("../run/ownership");
const { appendEvent, findSupervisedRun, getNextAction, writeCanonicalRun } = require("./state");

function buildReceipt(run, options = {}) {
  const task = run.tasks[0];
  const finalizable = task.status === "verified" && run.reviewer.decision === "PASS";
  return {
    schemaVersion: "supervised-receipt/v1-beta",
    generatedAt: options.generatedAt || new Date().toISOString(),
    runId: run.runId,
    goal: run.goal,
    source: run.source,
    planRevision: run.planRevision,
    mode: run.mode,
    execution: run.execution,
    assurance: run.assurance,
    status: run.status,
    task: {
      id: task.id,
      status: task.status,
      allowedFiles: task.allowedFiles,
      stoppingConditions: task.stoppingConditions,
      attempts: task.attempts,
      verification: task.verification,
      evidence: task.evidence,
    },
    reviewer: run.reviewer,
    budget: run.budget,
    usage: run.usage,
    localVerificationActivity: {
      runs: task.verification.runs.length,
      durationMs: task.verification.runs.reduce((total, entry) => total + entry.durationMs, 0),
    },
    managedModelOperations: run.usage.managedOperations,
    finalizable,
    finalized: run.status === "completed",
    warnings: [
      ...run.warnings,
      ...(run.assurance.profile === "prototype"
        ? ["Prototype assurance cannot claim production verification."]
        : []),
    ],
  };
}

function renderReceiptMarkdown(receipt) {
  return `# CEWP Supervised Receipt

- Run: ${receipt.runId}
- Goal: ${receipt.goal}
- Status: ${receipt.status}
- Execution: ${receipt.execution.owner} / ${receipt.execution.backend}
- Assurance: ${receipt.assurance.profile}
- Checkpoint: ${receipt.task.status}
- Reviewer: ${receipt.reviewer.decision || "none"}
- Finalizable: ${receipt.finalizable ? "yes" : "no"}
- Managed model operations: ${receipt.managedModelOperations.value}
- Host-internal usage: ${receipt.usage.hostInternal.label}
- Local verification runs: ${receipt.localVerificationActivity.runs}

Observed, estimated, budgeted, and unknown values are not interchangeable.
No merge, push, publish, tag, or release was performed.
`;
}

function writeReceiptFiles(runRoot, receipt, basename) {
  const jsonPath = path.join(runRoot, `${basename}.json`);
  const markdownPath = path.join(runRoot, `${basename}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderReceiptMarkdown(receipt));
  return {
    json: path.relative(runRoot, jsonPath).replace(/\\/g, "/"),
    markdown: path.relative(runRoot, markdownPath).replace(/\\/g, "/"),
  };
}

function previewSupervisedReceipt(options = {}) {
  const found = findSupervisedRun(options);
  if (found.run.status !== "review-passed" || found.run.reviewer.decision !== "PASS") {
    throw new Error("Receipt preview requires an independent reviewer PASS.");
  }
  const previewedAt = new Date().toISOString();
  const receipt = buildReceipt(found.run, { generatedAt: previewedAt });
  if (!receipt.finalizable) throw new Error("Receipt gates are closed; checkpoint is not finalizable.");
  const paths = writeReceiptFiles(found.runRoot, receipt, "receipt-preview");
  const run = {
    ...found.run,
    status: "ready-to-finalize",
    updatedAt: previewedAt,
    receipt: {
      status: "previewed",
      previewedAt,
      paths,
    },
  };
  writeCanonicalRun(found.runRoot, run);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: previewedAt,
    type: "receipt-previewed",
    runId: found.runId,
    paths,
  });
  return { run, runRoot: found.runRoot, receipt, nextAction: getNextAction(run) };
}

function updateOwnershipReleased(runRoot, releasedAt) {
  const ownershipPath = path.join(runRoot, "ownership.json");
  const ownership = validateOwnershipRecord(readJsonFile(ownershipPath, "execution ownership"));
  const next = { ...ownership, status: "released", releasedAt };
  const temporaryPath = `${ownershipPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temporaryPath, ownershipPath);
  return next;
}

function finalizeSupervisedRun(options = {}) {
  if (!options.yes) throw new Error("Supervised finalize requires --yes after receipt preview.");
  const found = findSupervisedRun(options);
  const task = found.run.tasks[0];
  if (found.run.status !== "ready-to-finalize" || found.run.reviewer.decision !== "PASS") {
    throw new Error("Supervised finalize requires receipt preview and independent reviewer PASS.");
  }
  assertPolicyAllows(found.repoRoot, "finalize");
  if (task.status !== "verified" || !task.evidence.some((entry) => entry.type === "verification")) {
    throw new Error("Supervised finalize requires verified checkpoint evidence.");
  }
  const ownership = validateOwnershipRecord(
    readJsonFile(path.join(found.runRoot, "ownership.json"), "execution ownership"),
  );
  if (ownership.status !== "verified") {
    throw new Error("Supervised finalize requires verified execution ownership.");
  }
  const changes = getWorktreeChangeSummary(ownership.worktree.path, found.run.repo.baseCommit);
  const scopeWarnings = findScopeWarnings(task.id, changes.changedFiles, task);
  if (changes.committedDiffError) scopeWarnings.push(changes.committedDiffError.message);
  if (scopeWarnings.length > 0) {
    throw new Error(`Supervised finalize scope gate failed:\n${scopeWarnings.join("\n")}`);
  }

  const completedAt = new Date().toISOString();
  const run = {
    ...found.run,
    status: "completed",
    updatedAt: completedAt,
    completedAt,
    tasks: [{ ...task, status: "completed" }],
    receipt: {
      ...found.run.receipt,
      status: "finalized",
      finalizedAt: completedAt,
    },
  };
  updateOwnershipReleased(found.runRoot, completedAt);
  const receipt = buildReceipt(run, { generatedAt: completedAt });
  const paths = writeReceiptFiles(found.runRoot, receipt, "receipt");
  run.receipt.paths = paths;
  writeCanonicalRun(found.runRoot, run);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: completedAt,
    type: "run-finalized",
    runId: found.runId,
    reviewerDecision: "PASS",
    paths,
  });
  return { run, runRoot: found.runRoot, receipt, nextAction: getNextAction(run) };
}

module.exports = {
  buildReceipt,
  finalizeSupervisedRun,
  previewSupervisedReceipt,
  renderReceiptMarkdown,
};
