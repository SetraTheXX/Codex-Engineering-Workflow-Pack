"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getGitHeadCommit } = require("../lib/git");
const { normalizeSlashPath } = require("../lib/paths");
const { loadHostBinding, loadIntegrationControlReceipt } = require("../integration/binding");
const { parseLifecycleEvents } = require("./events");
const { buildUsageObservations, unknownUsageEstimate } = require("./usage");
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
    recovery: {
      blocker: runtimeTask.blocker,
      failureHistory: runtimeTask.failureHistory || [],
      stateHistory: runtimeTask.stateHistory || [],
      interventions: (found.run.interventions || []).filter((entry) => entry.taskId === runtimeTask.id),
    },
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
  const usageObservations = buildUsageObservations(
    found,
    results.map((entry) => entry.value),
    reviewValues,
    warnings,
  );
  let complete = found.run.status === "finalized"
    && found.run.tasks.every((task) => task.status === "completed" && task.verification && task.verification.status === "passed")
    && (!found.run.reviewerPolicy.requiredForFinalize || found.run.reviewer.status === "passed");
  if (!complete) warnings.push({ code: "run-not-finalized", message: `Run status ${found.run.status} produces a partial receipt.` });
  const integrityFiles = integrityInventory(found, results, reviews, warnings);
  if (warnings.some((warning) => ["missing-referenced-evidence", "malformed-evidence-file", "malformed-event", "incompatible-event-schema", "invalid-event", "missing-events", "malformed-usage-observation-ledger"].includes(warning.code))) {
    complete = false;
  }
  const headCommit = getGitHeadCommit(found.repoRoot);
  const baseCommit = found.run.git && found.run.git.baseCommit;
  const hostBinding = loadHostBinding(found);
  const warningDeliveries = events
    .filter((entry) => entry.category === "warning-presentation")
    .map((entry) => ({
      warning: entry.warning || "unknown",
      surface: entry.surface || "unknown",
      deliveredAt: entry.timestamp,
      evidence: "event/v1",
    }));
  const knownCodexProvider = found.run.execution.backend === "codex-exec"
    || Boolean(hostBinding && hostBinding.host.product === "codex");

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
      provider: knownCodexProvider
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
      observations: usageObservations,
    },
    estimate: unknownUsageEstimate(),
    cost: { apiEquivalent: { label: "unknown", value: null, currency: null, pricingDate: null, model: null, reason: "no valid dated API pricing mapping" } },
    warningSurface: warningDeliveries.length > 0
      ? { status: "observed", deliveries: warningDeliveries }
      : { status: "unknown", deliveries: [] },
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
    integration: {
      nativeGoal: hostBinding && hostBinding.execution.owner === "native" && hostBinding.references.goalId
        ? {
          status: "known",
          goalId: hostBinding.references.goalId,
          surface: hostBinding.host.surface,
          authenticationBoundary: hostBinding.provenance.authenticationBoundary,
        }
        : { status: "unknown", goalId: null, reason: "no supported native goal binding" },
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
  const taskLines = receipt.tasks.flatMap((task) => {
    const recovery = task.recovery || { failureHistory: [], interventions: [] };
    return [
      `- ${task.id}: ${task.status}; attempts ${task.attempts}; scope ${task.scopeVerdict.status}`,
      `  - Allowed: ${task.allowedFiles.join(", ") || "none"}`,
      `  - Changed: ${task.changedFiles.join(", ") || "none"}`,
      `  - Artifacts: ${task.artifacts.map((entry) => `${entry.kind}:${entry.path}`).join(", ") || "none"}`,
      `  - Failure: ${task.failure ? `${task.failure.classification}: ${task.failure.summary}` : "none"}`,
      `  - Recovery: ${recovery.interventions.map((entry) => `${entry.event}: ${entry.reason}`).join("; ") || "none"}`,
    ];
  }).join("\n");
  const checkpointLines = receipt.checkpoints.map((entry) => {
    const baseline = entry.verification && entry.verification.baseline
      ? entry.verification.baseline.status
      : "unknown";
    return `- ${entry.checkpointId}: ${entry.status}; task ${entry.taskId}; attempt ${entry.attempt}; baseline ${baseline}; failure ${entry.failureClassification || "none"}`;
  }).join("\n");
  const commandLines = receipt.commands.flatMap((entry) => [
    `- ${entry.taskId} baseline: ${entry.verification.baseline || "none"}`,
    ...entry.verification.targeted.map((command) => `  - targeted: ${command}`),
    ...entry.verification.full.map((command) => `  - full: ${command}`),
  ]).join("\n");
  const revisionLines = receipt.planRevisions.map((entry) => (
    `- revision ${entry.revision}: ${entry.reason || entry.digest}; superseded ${entry.supersededAt || "unknown"}`
  )).join("\n");
  const interventionLines = receipt.interventions.map((entry) => (
    `- ${entry.event}: ${entry.reason}; actor ${entry.actor}; ${entry.recordedAt}`
  )).join("\n");
  const significantEventLines = receipt.events
    .filter((entry) => ["threshold", "warning-presentation", "safe-pause", "unverified-pause", "host-limit", "cancellation"].includes(entry.category))
    .map((entry) => `- ${entry.timestamp}: ${entry.category}/${entry.type}; ${entry.reason || entry.warning || entry.threshold || "recorded"}`)
    .join("\n");
  const allocationLines = receipt.budget.compliance.allocations.map((entry) => (
    `- ${entry.name}: ${entry.consumed}/${entry.approved}; protected ${entry.protected ? "yes" : "no"}; ${entry.respected ? "passed" : "failed"}`
  )).join("\n");
  const observationLines = receipt.usage.observations.map((entry) => (
    `- ${entry.category}/${entry.rawCategory}: ${entry.availability}; source ${entry.source.id}; auth ${entry.source.authenticationBoundary}; model ${entry.effectiveModel.status}`
  )).join("\n");
  const controlReceipt = receipt.policy.controls;
  const controlLines = controlReceipt
    ? controlReceipt.controls.map((entry) => `- ${entry.name}: ${entry.classification}; ${entry.effect}`).join("\n")
    : "- none";
  const warningLines = receipt.warnings.length > 0
    ? receipt.warnings.map((warning) => `- ${warning.code}: ${warning.message}`).join("\n")
    : "- none";
  return `# CEWP Evidence Receipt

- Run: ${receipt.runId}
- Goal: ${receipt.goal}
- Status: ${receipt.completeness.runStatus} (${receipt.completeness.status})
- Execution: ${receipt.execution.owner} / ${receipt.execution.backend || "none"}
- Operating modes: ${receipt.operatingModes.join(", ")}
- Provider: ${receipt.providers[0].provider.status === "known" ? receipt.providers[0].provider.value : "unknown"}
- Effective model: ${receipt.providers[0].effectiveModel.status === "known" ? receipt.providers[0].effectiveModel.value : "unknown"}
- Source: ${receipt.sourcePlan.kind}; ${receipt.sourcePlan.path || "direct goal"}
- Workflow: ${receipt.workflow.id} revision ${receipt.workflow.revision}; ${receipt.workflow.digest}
- Git base: ${receipt.git.baseCommit.status === "known" ? receipt.git.baseCommit.value : "unknown"}
- Git head: ${receipt.git.headCommit.value}
- Integrity: ${receipt.integrity.claim}; ${receipt.integrity.files.length} hashed files; not tamper-proof
${receipt.redaction && receipt.redaction.applied ? `- Redaction: applied (${receipt.redaction.replacements} replacements)\n` : ""}

## Tasks

${taskLines || "- none"}

## Checkpoints

${checkpointLines || "- none"}

## Commands and verification

${commandLines || "- none"}

## Plan revisions

${revisionLines || "- none"}

## Interventions and lifecycle decisions

${interventionLines || "- none"}
${significantEventLines ? `\n${significantEventLines}` : ""}

## Budget

- Compliance: ${receipt.budget.compliance.status}
- Absolute ceiling: ${receipt.budget.compliance.absoluteCeilingRespected ? "passed" : "failed"}
- Protected allocations: ${receipt.budget.compliance.protectedAllocationsRespected ? "passed" : "failed"}
- Pause reason: ${receipt.budget.pauseReason || "none"}

${allocationLines || "- none"}

## Usage and estimate

- Managed operations: ${receipt.usage.managedOperations.label}${receipt.usage.managedOperations.value === null ? "" : ` (${receipt.usage.managedOperations.value})`}
- Captured output: ${receipt.usage.capturedOutputBytes.label}${receipt.usage.capturedOutputBytes.value === null ? "" : ` (${receipt.usage.capturedOutputBytes.value})`}
- Managed tokens: ${receipt.usage.managedTokens.label}
- Host-internal usage: ${receipt.usage.hostInternal.label}
- Estimate: ${receipt.estimate.label}; confidence ${receipt.estimate.confidence}; samples ${receipt.estimate.sampleBasis.count}; estimator ${receipt.estimate.estimator.version}; drift ${receipt.estimate.drift.state}
- API-equivalent cost: ${receipt.cost.apiEquivalent.label}${receipt.cost.apiEquivalent.model ? `; model ${receipt.cost.apiEquivalent.model}; pricing ${receipt.cost.apiEquivalent.pricingDate}` : ""}
- Warning surface: ${receipt.warningSurface.status}; deliveries ${receipt.warningSurface.deliveries.length}

${observationLines || "- no usage observations"}

## Controls

- Execution owner: ${receipt.execution.owner}
- Preventive enforced: ${controlReceipt ? controlReceipt.summary.preventiveEnforced : 0}
- Imported observed: ${controlReceipt ? controlReceipt.summary.importedObserved : 0}

${controlLines}

## Final review

- Status: ${receipt.reviewer.status}
- Decision: ${receipt.reviewer.decision || "none"}
- Review ID: ${receipt.reviewer.reviewId || "none"}
- Reviews recorded: ${receipt.reviews.length}

## Timestamps

- Created: ${receipt.timestamps.createdAt}
- Updated: ${receipt.timestamps.updatedAt}
- Finalized: ${receipt.timestamps.finalizedAt || "none"}
- Receipt generated: ${receipt.timestamps.generatedAt}

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
