"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { verifyWorkflowRun } = require("../evidence/verify");
const { loadWorkflowRun } = require("../workflow/state");

function sha256(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function inspectReviewedRunEvidence(repoRoot, workflowRunId) {
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
