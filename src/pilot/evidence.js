"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { verifyWorkflowRun } = require("../evidence/verify");
const { loadWorkflowRun } = require("../workflow/state");
const { findSupervisedRun } = require("../supervise/state");
const { validateOwnershipRecord } = require("../run/ownership");

function sha256(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function inspectSupervisedRunEvidence(repoRoot, supervisedRunId) {
  let found;
  try {
    found = findSupervisedRun({ repoRoot, runId: supervisedRunId });
  } catch (error) {
    return {
      status: "excluded",
      reason: `supervised run is unavailable: ${error.message}`,
      runKind: "supervised",
      supervisedRunId,
      verification: { schemaVersion: "supervised-verification/v1", status: "failed", issues: [{ code: "run-unavailable", message: error.message }] },
      receipt: null,
      reviewer: { decision: null, independentPass: false },
      rawEvidenceCopied: false,
    };
  }
  const receiptPath = path.join(found.runRoot, "receipt.json");
  const ownershipPath = path.join(found.runRoot, "ownership.json");
  let receiptValue = null;
  let ownership = null;
  try {
    receiptValue = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch {}
  try {
    ownership = validateOwnershipRecord(JSON.parse(fs.readFileSync(ownershipPath, "utf8")));
  } catch {}
  const tasks = Array.isArray(found.run.tasks) ? found.run.tasks : [];
  const verificationPassed = tasks.length > 0 && tasks.every((task) => (
    task.status === "completed"
    && task.verification?.latest?.status === "pass"
    && task.verification?.scope?.status === "pass"
    && (task.evidence || []).some((entry) => entry.type === "verification")
  ));
  const independentPass = found.run.reviewer?.independent === true
    && found.run.reviewer?.status === "passed"
    && found.run.reviewer?.decision === "PASS"
    && tasks.every((task) => (task.evidence || []).some((entry) => entry.type === "independent-review" && entry.decision === "PASS"));
  let reason = null;
  if (found.run.status !== "completed") reason = `supervised run is not completed (status ${found.run.status})`;
  else if (found.run.receipt?.status !== "finalized") reason = "supervised run receipt is not finalized";
  else if (!receiptValue || receiptValue.schemaVersion !== "supervised-receipt/v1-beta" || receiptValue.runId !== supervisedRunId || receiptValue.finalized !== true) reason = "supervised receipt is missing, incomplete, or incompatible";
  else if (!verificationPassed) reason = "supervised run verification or scope evidence failed";
  else if (!independentPass) reason = "supervised run lacks an independent reviewer PASS";
  else if (ownership?.runId !== supervisedRunId || ownership?.status !== "released") reason = "supervised execution ownership is invalid or not released";
  return {
    status: reason ? "excluded" : "qualified",
    reason,
    runKind: "supervised",
    supervisedRunId,
    verification: {
      schemaVersion: "supervised-verification/v1",
      status: verificationPassed ? "passed" : "failed",
      issues: verificationPassed ? [] : [{ code: "supervised-verification-failed", message: "Verification, scope, or task evidence did not pass." }],
    },
    receipt: receiptValue ? {
      schemaVersion: receiptValue.schemaVersion || null,
      generatedAt: receiptValue.generatedAt || null,
      completeness: receiptValue.finalized === true ? "complete" : "incomplete",
      integrityClaim: "finalization-gated-local-receipt",
      sha256: sha256(receiptPath),
    } : null,
    reviewer: { decision: found.run.reviewer?.decision || null, independentPass },
    ownership: { status: ownership?.status || "unknown" },
    rawEvidenceCopied: false,
  };
}

function inspectReviewedRunEvidence(repoRoot, runReference) {
  if (runReference && typeof runReference === "object" && runReference.supervisedRunId) {
    return inspectSupervisedRunEvidence(repoRoot, runReference.supervisedRunId);
  }
  const workflowRunId = typeof runReference === "string" ? runReference : runReference?.workflowRunId;
  let found;
  try {
    found = loadWorkflowRun(repoRoot, workflowRunId);
  } catch (error) {
    return {
      status: "excluded",
      reason: `workflow run is unavailable: ${error.message}`,
      workflowRunId,
      verification: { schemaVersion: "run-verification/v1", status: "failed", issues: [{ code: "run-unavailable", message: error.message }] },
      receipt: null,
      rawEvidenceCopied: false,
    };
  }
  const verification = verifyWorkflowRun(repoRoot, workflowRunId);
  const receiptPath = path.join(found.runRoot, "evidence-receipt.json");
  let receipt = null;
  if (fs.existsSync(receiptPath)) {
    try {
      const value = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      receipt = {
        schemaVersion: value.schemaVersion || null,
        generatedAt: value.generatedAt || null,
        completeness: value.completeness?.status || "unknown",
        integrityClaim: value.integrity?.claim || null,
        sha256: sha256(receiptPath),
      };
    } catch (error) {
      receipt = { schemaVersion: null, generatedAt: null, completeness: "malformed", integrityClaim: null, sha256: sha256(receiptPath) };
    }
  }
  const reviewsRoot = path.join(found.runRoot, "reviews");
  const reviews = fs.existsSync(reviewsRoot)
    ? fs.readdirSync(reviewsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(reviewsRoot, entry.name), "utf8"));
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean)
    : [];
  const independentPass = reviews.some((review) => review.independent === true && review.decision === "PASS");
  let reason = null;
  if (found.run.status !== "finalized") reason = `workflow run is not finalized (status ${found.run.status})`;
  else if (!receipt) reason = "workflow run has no persisted evidence receipt";
  else if (receipt.schemaVersion !== "evidence-receipt/v1" || receipt.completeness !== "complete") reason = "workflow receipt is incomplete or incompatible";
  else if (verification.status !== "passed") reason = "workflow run verification failed";
  else if (found.run.reviewer?.decision !== "PASS" || !independentPass) reason = "workflow run lacks an independent reviewer PASS";
  return {
    status: reason ? "excluded" : "qualified",
    reason,
    runKind: "workflow",
    workflowRunId,
    verification: {
      schemaVersion: verification.schemaVersion,
      status: verification.status,
      issues: verification.issues.map((issue) => ({ code: issue.code, message: issue.message })),
    },
    receipt,
    reviewer: {
      decision: found.run.reviewer?.decision || null,
      independentPass,
    },
    rawEvidenceCopied: false,
  };
}

module.exports = {
  inspectReviewedRunEvidence,
};
