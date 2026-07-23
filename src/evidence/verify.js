"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeSlashPath } = require("../lib/paths");
const { loadWorkflowRun } = require("../workflow/state");
const { parseLifecycleEvents } = require("./events");
const { buildEvidenceReceipt } = require("./receipt");

const RUN_VERIFICATION_SCHEMA_VERSION = "run-verification/v1";

function sha256(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function isInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function check(id, issues, startIndex, skipped = false) {
  const ownIssues = issues.slice(startIndex);
  return {
    id,
    status: skipped ? "not-applicable" : ownIssues.some((entry) => entry.severity === "error") ? "failed" : "passed",
    issueCount: ownIssues.length,
  };
}

function issue(issues, code, message, details = {}) {
  issues.push({ severity: "error", code, message, ...details });
}

function readJsonRecords(rootPath, issues, code) {
  if (!fs.existsSync(rootPath)) return [];
  return fs.readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(rootPath, entry.name);
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (error) {
        issue(issues, code, `Artifact is not valid JSON: ${normalizeSlashPath(path.relative(rootPath, filePath))}: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function verifyReceipt(found, issues) {
  const receiptPath = path.join(found.runRoot, "evidence-receipt.json");
  if (!fs.existsSync(receiptPath)) {
    if (found.run.status === "finalized") {
      issue(issues, "missing-evidence-receipt", "Finalized workflow run has no evidence receipt.");
    }
    return false;
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (error) {
    issue(issues, "malformed-evidence-receipt", `Evidence receipt is not valid JSON: ${error.message}`);
    return true;
  }
  if (receipt.schemaVersion !== "evidence-receipt/v1" || receipt.runId !== found.run.runId) {
    issue(issues, "incompatible-evidence-receipt", "Evidence receipt schema or run identity is incompatible.");
    return true;
  }
  const files = receipt.integrity && receipt.integrity.files;
  if (!Array.isArray(files)) {
    issue(issues, "malformed-evidence-receipt", "Evidence receipt integrity inventory is missing.");
    return true;
  }
  try {
    const rebuilt = buildEvidenceReceipt(found, { generatedAt: receipt.generatedAt });
    if (JSON.stringify(rebuilt.integrity) !== JSON.stringify(receipt.integrity)) {
      issue(issues, "receipt-integrity-inventory-mismatch", "Receipt integrity inventory does not match current canonical evidence.");
    }
  } catch (error) {
    issue(issues, "receipt-integrity-rebuild-failed", `Could not rebuild canonical receipt integrity: ${error.message}`);
  }
  for (const entry of files) {
    const filePath = typeof entry.path === "string" ? path.resolve(found.repoRoot, entry.path) : "";
    if (!filePath || !isInside(found.repoRoot, filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      issue(issues, "receipt-integrity-missing", `Receipt evidence is unavailable: ${entry.path || "missing path"}.`, { path: entry.path || null });
      continue;
    }
    const actual = sha256(filePath);
    const bytes = fs.statSync(filePath).size;
    if (actual !== entry.sha256 || bytes !== entry.bytes) {
      issue(issues, "receipt-integrity-mismatch", `Receipt evidence changed: ${entry.path}.`, {
        path: entry.path,
        expectedSha256: entry.sha256,
        actualSha256: actual,
      });
    }
  }
  return true;
}

function verifyBoundWorktree(found, issues) {
  const bindingPath = path.join(found.runRoot, "integration", "host-binding.json");
  if (!fs.existsSync(bindingPath)) return false;
  let binding;
  try {
    binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  } catch (error) {
    issue(issues, "malformed-host-binding", `Host binding is not valid JSON: ${error.message}`);
    return true;
  }
  const worktree = binding.references && binding.references.worktree;
  if (worktree && typeof worktree.path === "string" && !fs.existsSync(path.resolve(found.repoRoot, worktree.path))) {
    issue(issues, "stale-worktree", `Bound worktree is unavailable: ${normalizeSlashPath(worktree.path)}.`, {
      worktreeId: worktree.id || null,
    });
  }
  return true;
}

function verifyWorkflowRun(repoRoot, runId) {
  const issues = [];
  const checks = [];
  let found;
  let start = issues.length;
  try {
    found = loadWorkflowRun(repoRoot, runId);
  } catch (error) {
    issue(issues, "state-inconsistent", error.message);
  }
  checks.push(check("state-consistency", issues, start));
  if (!found) {
    return {
      schemaVersion: RUN_VERIFICATION_SCHEMA_VERSION,
      runId,
      status: "failed",
      checks,
      issues,
      execution: { agentsExecuted: false, verificationCommandsExecuted: false },
    };
  }

  start = issues.length;
  const eventsPath = path.join(found.runRoot, "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    issue(issues, "missing-events", "Workflow event ledger is missing.");
  } else {
    const parsed = parseLifecycleEvents(fs.readFileSync(eventsPath, "utf8"), { runId });
    for (const entry of parsed.issues) issue(issues, entry.code, entry.message, { line: entry.line });
  }
  checks.push(check("event-ledger", issues, start));

  start = issues.length;
  for (const task of found.run.tasks) {
    if (task.resultId) {
      const results = readJsonRecords(path.join(found.runRoot, "results", task.id), issues, "malformed-task-result");
      if (!results.some((entry) => entry.resultId === task.resultId)) {
        issue(issues, "missing-task-result", `Task ${task.id} references result ${task.resultId}, but that result is missing.`, { taskId: task.id });
      }
    }
    if (task.activeCheckpointId) {
      const checkpoints = readJsonRecords(path.join(found.runRoot, "checkpoints", task.id), issues, "malformed-checkpoint");
      if (!checkpoints.some((entry) => entry.checkpointId === task.activeCheckpointId)) {
        issue(issues, "missing-checkpoint", `Task ${task.id} active checkpoint ${task.activeCheckpointId} is missing.`, { taskId: task.id });
      }
    }
  }
  checks.push(check("required-artifacts", issues, start));

  start = issues.length;
  const hadBinding = verifyBoundWorktree(found, issues);
  checks.push(check("worktree-liveness", issues, start, !hadBinding));

  start = issues.length;
  const hadReceipt = verifyReceipt(found, issues);
  checks.push(check("receipt-integrity", issues, start, !hadReceipt));

  return {
    schemaVersion: RUN_VERIFICATION_SCHEMA_VERSION,
    runId,
    status: issues.some((entry) => entry.severity === "error") ? "failed" : "passed",
    checks,
    issues,
    execution: { agentsExecuted: false, verificationCommandsExecuted: false },
  };
}

module.exports = {
  RUN_VERIFICATION_SCHEMA_VERSION,
  verifyWorkflowRun,
};
