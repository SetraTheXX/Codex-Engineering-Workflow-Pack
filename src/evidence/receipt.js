"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getGitHeadCommit } = require("../lib/git");
const { normalizeSlashPath } = require("../lib/paths");
const { loadIntegrationControlReceipt } = require("../integration/binding");
const { parseLifecycleEvents } = require("./events");
const { writeJsonAtomic } = require("../workflow/state");

const EVIDENCE_RECEIPT_SCHEMA_VERSION = "evidence-receipt/v1";
const RECEIPT_BASENAMES = new Set(["evidence-receipt.json", "evidence-receipt.md"]);

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function listFiles(rootPath) {
  if (!fs.existsSync(rootPath)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  };
  visit(rootPath);
  return files.sort((left, right) => lexicalCompare(normalizeSlashPath(left), normalizeSlashPath(right)));
}

function readJsonDirectory(found, rootPath, label, warnings) {
  return listFiles(rootPath)
    .filter((filePath) => filePath.endsWith(".json"))
    .map((filePath) => {
      try {
        return { path: filePath, value: readJson(filePath, label) };
      } catch (error) {
        warnings.push({
          code: "malformed-evidence-file",
          path: normalizeSlashPath(path.relative(found.repoRoot, filePath)),
          message: error.message,
        });
        return null;
      }
    })
    .filter(Boolean);
}

function readEvents(found, warnings) {
  const eventPath = path.join(found.runRoot, "events.jsonl");
  if (!fs.existsSync(eventPath)) {
    warnings.push({ code: "missing-events", message: "Workflow event ledger is missing." });
    return [];
  }
  const parsed = parseLifecycleEvents(fs.readFileSync(eventPath, "utf8"), { runId: found.run.runId });
  warnings.push(...parsed.issues);
  return parsed.events;
}

function truthAggregate(values, reason) {
  const present = values.filter(Boolean);
  if (present.length > 0 && present.every((entry) => entry.label === "observed")) {
    return {
      label: "observed",
      value: present.reduce((total, entry) => total + entry.value, 0),
      sources: [...new Set(present.map((entry) => entry.source).filter(Boolean))].sort(),
    };
  }
  return { label: "unknown", value: null, reason };
}

function safeEvidencePath(found, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null;
  const resolved = path.resolve(found.repoRoot, relativePath);
  return isInside(found.repoRoot, resolved) ? resolved : null;
}

function referencedPaths(results, reviews) {
  const paths = [];
  for (const result of results) {
    for (const entry of result.value.verification.baseline.evidence || []) paths.push(entry.evidencePath);
    for (const entry of result.value.verification.targeted || []) paths.push(entry.evidencePath);
    for (const entry of result.value.verification.full || []) paths.push(entry.evidencePath);
    for (const artifact of result.value.artifacts || []) paths.push(artifact.path);
    for (const evidencePath of (result.value.failure && result.value.failure.evidencePaths) || []) paths.push(evidencePath);
  }
  for (const review of reviews) {
    for (const evidence of review.value.evidence || []) paths.push(evidence.path);
    for (const finding of review.value.findings || []) {
      for (const evidencePath of finding.evidencePaths || []) paths.push(evidencePath);
    }
  }
  return [...new Set(paths)].sort();
}

function hashFile(found, filePath) {
  const content = fs.readFileSync(filePath);
  return {
    path: normalizeSlashPath(path.relative(found.repoRoot, filePath)),
    sha256: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
    bytes: content.length,
  };
}

function integrityInventory(found, results, reviews, warnings) {
  const canonical = listFiles(found.runRoot).filter((filePath) => {
    if (RECEIPT_BASENAMES.has(path.basename(filePath))) return false;
    const relative = normalizeSlashPath(path.relative(found.runRoot, filePath));
    return relative === "run.json"
      || relative === "events.jsonl"
      || relative.startsWith("checkpoints/")
      || relative.startsWith("results/")
      || relative.startsWith("reviews/")
      || relative.startsWith("integration/");
  });
  const definitionPath = path.resolve(found.repoRoot, found.run.workflow.definitionPath);
  if (isInside(found.repoRoot, definitionPath) && fs.existsSync(definitionPath)) canonical.push(definitionPath);
  for (const relativePath of referencedPaths(results, reviews)) {
    const filePath = safeEvidencePath(found, relativePath);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      warnings.push({ code: "missing-referenced-evidence", path: relativePath, message: "Referenced evidence file is unavailable." });
      continue;
    }
    canonical.push(filePath);
  }
  return [...new Set(canonical.map((entry) => path.resolve(entry)))]
    .map((filePath) => hashFile(found, filePath))
    .sort((left, right) => lexicalCompare(left.path, right.path));
}

function taskReceipt(found, runtimeTask, resultsByTask) {
  const definitionTask = found.definition.tasks.find((entry) => entry.id === runtimeTask.id);
  const result = resultsByTask.get(runtimeTask.id) || null;
  return {
    id: runtimeTask.id,
    title: definitionTask.title,
    status: runtimeTask.status,
    attempts: runtimeTask.attempts,
    allowedFiles: definitionTask.allowedFiles,
    forbiddenFiles: definitionTask.forbiddenFiles,
    stoppingConditions: definitionTask.stoppingConditions,
    changedFiles: result ? result.changedFiles : [],
    scopeVerdict: result ? { status: "passed", basis: "validated-task-result" } : { status: "unknown", basis: "result-unavailable" },
    verification: result ? result.verification : {
      baseline: { status: "unknown", evidence: [] },
      targeted: [],
      full: [],
    },
    failure: result ? result.failure : null,
    artifacts: result ? result.artifacts : [],
    resultId: runtimeTask.resultId,
  };
}

function checkpointReceipt(entry) {
  return {
    checkpointId: entry.value.checkpointId,
    taskId: entry.value.taskId,
    attempt: entry.value.attempt,
    status: entry.value.status,
    startedAt: entry.value.startedAt,
    completedAt: entry.value.completedAt,
    failureClassification: entry.value.failureClassification,
    interventionState: entry.value.interventionState,
    reviewer: entry.value.reviewer,
    result: entry.value.result,
    verification: entry.value.verification,
  };
}

function budgetReceipt(budget) {
  const allocationChecks = Object.keys(budget.allocations).sort().map((name) => ({
    name,
    approved: budget.allocations[name],
    consumed: budget.consumed.allocations[name],
    respected: budget.consumed.allocations[name] <= budget.allocations[name],
    protected: budget.protectedAllocations.includes(name),
  }));
  const ceilings = {
    modelOperations: budget.consumed.modelOperations <= budget.modelOperations,
    targetedVerificationRuns: budget.consumed.targetedVerificationRuns <= budget.maxTargetedVerificationRuns,
    fullVerificationRuns: budget.consumed.fullVerificationRuns <= budget.maxFullVerificationRuns,
    capturedOutputBytes: budget.consumed.capturedOutputBytes <= budget.maxCapturedOutputBytes,
  };
  const respected = Object.values(ceilings).every(Boolean) && allocationChecks.every((entry) => entry.respected);
  return {
    ...budget,
    compliance: {
      status: respected ? "passed" : "failed",
      absoluteCeilingRespected: ceilings.modelOperations,
      protectedAllocationsRespected: allocationChecks.filter((entry) => entry.protected).every((entry) => entry.respected),
      ceilings,
      allocations: allocationChecks,
    },
  };
}

function buildEvidenceReceipt(found, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const warnings = [];
  const results = readJsonDirectory(found, path.join(found.runRoot, "results"), "workflow result", warnings);
  const reviews = readJsonDirectory(found, path.join(found.runRoot, "reviews"), "workflow review", warnings);
  const checkpoints = readJsonDirectory(found, path.join(found.runRoot, "checkpoints"), "workflow checkpoint", warnings);
  const events = readEvents(found, warnings);
  const resultsByTask = new Map(results.map((entry) => [entry.value.taskId, entry.value]));
  const reviewValues = reviews.map((entry) => entry.value);
  const usageValues = [...results.map((entry) => entry.value), ...reviewValues].map((entry) => entry.usage);
  let complete = found.run.status === "finalized"
    && found.run.tasks.every((task) => task.status === "completed" && task.verification && task.verification.status === "passed")
    && (!found.run.reviewerPolicy.requiredForFinalize || found.run.reviewer.status === "passed");
  if (!complete) warnings.push({ code: "run-not-finalized", message: `Run status ${found.run.status} produces a partial receipt.` });
  const integrityFiles = integrityInventory(found, results, reviews, warnings);
  if (warnings.some((warning) => ["missing-referenced-evidence", "malformed-evidence-file", "malformed-event", "incompatible-event-schema", "invalid-event", "missing-events"].includes(warning.code))) {
    complete = false;
  }
  const headCommit = getGitHeadCommit(found.repoRoot);
  const baseCommit = found.run.git && found.run.git.baseCommit;

  return {
    schemaVersion: EVIDENCE_RECEIPT_SCHEMA_VERSION,
    generatedAt,
    runId: found.run.runId,
    goal: found.run.goal,
    sourcePlan: found.run.approval.source,
    workflow: found.run.workflow,
    planRevisions: found.run.revisionHistory || [],
    operatingModes: found.run.execution.allowedModes,
    execution: {
      owner: found.run.execution.owner,
      backend: found.run.execution.backend,
    },
    assurance: found.run.assurance,
    completeness: { status: complete ? "complete" : "partial", runStatus: found.run.status },
    tasks: found.run.tasks.map((task) => taskReceipt(found, task, resultsByTask)),
    checkpoints: checkpoints.map(checkpointReceipt),
    interventions: found.run.interventions || [],
    events,
    providers: [{
      provider: found.run.execution.backend === "codex-exec"
        ? { status: "known", value: "codex" }
        : { status: "unknown", value: null, reason: "selected execution boundary does not identify a provider" },
      effectiveModel: { status: "unknown", value: null, reason: "workflow result does not expose an effective model" },
    }],
    commands: found.definition.tasks.map((task) => ({ taskId: task.id, verification: task.verification })),
    reviewer: found.run.reviewer,
    reviews: reviewValues,
    reviewHistory: found.run.reviewHistory || [],
    budget: budgetReceipt(found.run.budget),
    usage: {
      managedOperations: truthAggregate(usageValues.map((usage) => usage && usage.managedOperations), "no uniformly observed managed operation evidence"),
      capturedOutputBytes: truthAggregate(usageValues.map((usage) => usage && usage.capturedOutputBytes), "no uniformly observed captured output evidence"),
      managedTokens: truthAggregate(usageValues.map((usage) => usage && usage.managedTokens), "managed token totals are unavailable"),
      hostInternal: truthAggregate(usageValues.map((usage) => usage && usage.hostInternal), "host-internal usage is unavailable"),
    },
    estimate: { schemaVersion: "usage-estimate/v1", label: "unknown", range: null, confidence: "unavailable", sampleBasis: null, driftState: "unknown" },
    cost: { apiEquivalent: { label: "unknown", value: null, currency: null, pricingDate: null, model: null, reason: "no valid dated API pricing mapping" } },
    warningSurface: { status: "unknown", deliveries: [] },
    git: {
      baseCommit: baseCommit
        ? { status: "known", value: baseCommit }
        : { status: "unknown", value: null, reason: "historical run predates source git identity" },
      headCommit: { status: "known", value: headCommit },
    },
    policy: {
      approval: found.run.approval,
      assurance: found.run.assurance,
      controls: loadIntegrationControlReceipt(found),
    },
    integrity: {
      algorithm: "sha256",
      claim: "tamper-evident-local-metadata",
      tamperProof: false,
      files: integrityFiles,
      sourceIdentities: {
        workflowDigest: found.run.workflow.digest,
        sourcePlanSha256: found.run.approval.source.sha256,
        gitBaseCommit: baseCommit || null,
        gitHeadCommit: headCommit,
      },
    },
    timestamps: {
      createdAt: found.run.createdAt,
      updatedAt: found.run.updatedAt,
      finalizedAt: found.run.finalization ? found.run.finalization.finalizedAt : null,
      generatedAt,
    },
    warnings,
  };
}

function renderEvidenceReceiptMarkdown(receipt) {
  const taskLines = receipt.tasks.map((task) => (
    `- ${task.id}: ${task.status}; attempts ${task.attempts}; scope ${task.scopeVerdict.status}; changed ${task.changedFiles.join(", ") || "none"}`
  )).join("\n");
  const warningLines = receipt.warnings.length > 0
    ? receipt.warnings.map((warning) => `- ${warning.code}: ${warning.message}`).join("\n")
    : "- none";
  return `# CEWP Evidence Receipt

- Run: ${receipt.runId}
- Goal: ${receipt.goal}
- Status: ${receipt.completeness.runStatus} (${receipt.completeness.status})
- Execution: ${receipt.execution.owner} / ${receipt.execution.backend || "none"}
- Reviewer: ${receipt.reviewer.decision || "none"}
- Source: ${receipt.sourcePlan.kind}; ${receipt.sourcePlan.path || "direct goal"}
- Git base: ${receipt.git.baseCommit.status === "known" ? receipt.git.baseCommit.value : "unknown"}
- Git head: ${receipt.git.headCommit.value}
- Managed operations: ${receipt.usage.managedOperations.label}${receipt.usage.managedOperations.value === null ? "" : ` (${receipt.usage.managedOperations.value})`}
- Host-internal usage: ${receipt.usage.hostInternal.label}
- API-equivalent cost: ${receipt.cost.apiEquivalent.label}
- Integrity: ${receipt.integrity.claim}; ${receipt.integrity.files.length} hashed files; not tamper-proof

## Tasks

${taskLines || "- none"}

## Warnings

${warningLines}

This receipt excludes raw prompts and raw log contents by default.
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

function writeEvidenceReceipt(found, options = {}) {
  const receipt = buildEvidenceReceipt(found, options);
  const jsonPath = path.join(found.runRoot, "evidence-receipt.json");
  const markdownPath = path.join(found.runRoot, "evidence-receipt.md");
  writeJsonAtomic(jsonPath, receipt);
  writeTextAtomic(markdownPath, renderEvidenceReceiptMarkdown(receipt));
  return { receipt, paths: { json: jsonPath, markdown: markdownPath } };
}

module.exports = {
  EVIDENCE_RECEIPT_SCHEMA_VERSION,
  buildEvidenceReceipt,
  renderEvidenceReceiptMarkdown,
  writeEvidenceReceipt,
};
