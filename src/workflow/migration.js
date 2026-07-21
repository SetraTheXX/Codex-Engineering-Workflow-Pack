"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ensureDir } = require("../lib/fs");
const { normalizeSlashPath } = require("../lib/paths");
const { findSupervisedRun } = require("../supervise/state");
const {
  digestWorkflowDefinition,
  validateWorkflowDefinition,
} = require("./definition");
const {
  createApprovedRun,
  writeJsonAtomic,
  writeWorkflowProgress,
} = require("./state");

const LEGACY_SCHEMA_VERSION = "supervised-run/v1";
const MIGRATION_PROJECTION_VERSION = "supervised-v1-to-workflow-v2/v1";
const ACTIVE_LEGACY_STATUSES = new Set(["executing", "verifying", "reviewing"]);

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function budgetValue(value, fallback = 0) {
  return value && Number.isInteger(value.value) ? value.value : fallback;
}

function legacyTasks(run) {
  const ordered = [...(run.checkpointHistory || []), ...(run.tasks || [])];
  const byId = new Map();
  for (const task of ordered) byId.set(task.id, task);
  return [...byId.values()];
}

function projectDefinition(run) {
  const sourceTasks = legacyTasks(run);
  const tasks = sourceTasks.map((task, index) => ({
    id: task.id,
    title: task.title,
    dependsOn: index === 0 ? [] : [sourceTasks[index - 1].id],
    allowedFiles: task.allowedFiles,
    forbiddenFiles: task.forbiddenFiles.filter((entry) => !/^\.git(?:\/|$)/.test(entry)),
    stoppingConditions: task.stoppingConditions,
    verification: {
      targeted: task.verification.targeted,
      full: task.verification.full,
    },
    risk: "medium",
  }));
  const legacyBudget = run.budget;
  const maxRepairs = budgetValue(legacyBudget.maxRepairsPerCheckpoint, 2);
  const targetedCommands = tasks.reduce((total, task) => total + task.verification.targeted.length, 0);
  const fullCommands = tasks.reduce((total, task) => total + task.verification.full.length, 0);
  const allocations = {
    implementation: budgetValue(legacyBudget.allocations.implementation),
    repair: budgetValue(legacyBudget.allocations.repair),
    completion: 1,
    reviewer: budgetValue(legacyBudget.allocations.reviewer),
    finalization: budgetValue(legacyBudget.allocations.finalization),
  };
  const modelOperations = Object.values(allocations).reduce((total, value) => total + value, 0);
  return validateWorkflowDefinition({
    schemaVersion: "workflow-definition/v1",
    workflowId: `supervised-${run.runId}`,
    revision: {
      number: 1,
      parent: null,
      reason: `Explicit migration from ${LEGACY_SCHEMA_VERSION}`,
    },
    goal: run.goal,
    tasks,
    assurance: {
      profile: run.assurance.profile,
      testAuthoring: run.assurance.testAuthoring,
    },
    checkpointPolicy: {
      required: true,
      reviewerAfterEachTask: false,
    },
    reviewerPolicy: {
      requiredForFinalize: run.reviewer.required !== false,
    },
    execution: {
      owner: run.execution.owner,
      backend: run.execution.backend,
      allowedModes: ["supervised"],
    },
    budget: {
      schemaVersion: "budget-envelope/v1",
      modelOperations,
      allocations,
      protectedAllocations: ["completion", "reviewer", "finalization"],
      maxRepairsPerCheckpoint: maxRepairs,
      maxElapsedMinutes: budgetValue(legacyBudget.maxElapsedMinutes, 45),
      maxConcurrentWorkers: budgetValue(legacyBudget.maxConcurrentWorkers, 1),
      maxCapturedOutputBytes: budgetValue(legacyBudget.maxCapturedOutputBytes, 1024 * 1024),
      maxTargetedVerificationRuns: Math.max(
        budgetValue(legacyBudget.maxTargetedVerificationRuns, 1),
        targetedCommands * (2 + maxRepairs),
      ),
      maxFullVerificationRuns: Math.max(
        budgetValue(legacyBudget.maxFullVerificationRuns, 0),
        fullCommands,
      ),
      thresholds: {
        earlyWarningPercent: budgetValue(legacyBudget.thresholds.earlyWarningPercent, 70),
        reservePercent: budgetValue(legacyBudget.thresholds.reservePercent, 90),
        absoluteCeilingPercent: budgetValue(legacyBudget.thresholds.absoluteCeilingPercent, 100),
      },
    },
  });
}

function taskStatus(value) {
  if (["verified", "completed"].includes(value)) return "completed";
  if (["executing", "running"].includes(value)) return "running";
  if (value === "verifying") return "verifying";
  if (["repair-ready", "blocked", "failed"].includes(value)) return "blocked";
  if (["cancelled", "abandoned", "rolled-back", "timed-out"].includes(value)) return value;
  if (["proposed", "approved", "ready"].includes(value)) return "ready";
  return "pending";
}

function runStatus(run) {
  const status = run.status;
  if (["proposed", "approved"].includes(status)) return "approved";
  if (["executing", "verifying", "reviewing"].includes(status)) return "paused-budget-unverified";
  if (status === "checkpoint-complete") return "review-pending";
  if (["review-passed", "ready-to-finalize"].includes(status)) return "completed";
  if (status === "completed") return "finalized";
  if (["needs-repair", "blocked"].includes(status)) return "blocked";
  if (["paused-budget-safe", "paused-budget-unverified", "paused-host-limit"].includes(status)) return status;
  if (["cancelled", "abandoned", "rolled-back", "timed-out"].includes(status)) return status;
  return "blocked";
}

function projectRuntimeBudget(run, definition) {
  const legacy = run.budget;
  const consumed = legacy.consumed || {};
  const consumedAllocations = consumed.allocations || {};
  return {
    ...definition.budget,
    consumed: {
      modelOperations: consumed.modelOperations || 0,
      allocations: {
        implementation: consumedAllocations.implementation || 0,
        repair: consumedAllocations.repair || 0,
        completion: 0,
        reviewer: consumedAllocations.reviewer || 0,
        finalization: consumedAllocations.finalization || 0,
      },
      targetedVerificationRuns: consumed.targetedVerificationRuns || 0,
      fullVerificationRuns: consumed.fullVerificationRuns || 0,
      capturedOutputBytes: consumed.capturedOutputBytes || 0,
    },
    thresholdEvents: legacy.thresholdEvents || [],
    revisions: [...(legacy.revisions || []), {
      revision: (legacy.revisions || []).length + 1,
      event: "schema-migration",
      sourceSchema: LEGACY_SCHEMA_VERSION,
    }],
    hostLimit: legacy.hostLimit || null,
    pauseReason: run.pause ? run.pause.reason : null,
    resumeStatus: null,
  };
}

function projectReviewer(run) {
  const status = run.reviewer && run.reviewer.status;
  return {
    status: status === "passed"
      ? "passed"
      : status === "changes-requested" ? "changes-requested" : status === "blocked" ? "blocked" : "pending",
    decision: run.reviewer ? run.reviewer.decision : null,
    independent: run.reviewer ? run.reviewer.independent !== false : true,
    legacyReference: run.reviewer || null,
  };
}

function projectLegacyRun(found, definition, sourceDigest) {
  const projectedStatus = runStatus(found.run);
  const projectedTasks = legacyTasks(found.run).map((legacyTask) => {
    const status = taskStatus(legacyTask.status);
    const resultId = status === "completed" ? `legacy-${legacyTask.id}-result` : null;
    return {
      id: legacyTask.id,
      status,
      attempts: Array.isArray(legacyTask.attempts) ? legacyTask.attempts.length : 0,
      activeCheckpointId: null,
      resultId,
      verification: resultId ? {
        status: "passed",
        checkpointId: legacyTask.id,
        resultId,
        legacyEvidence: legacyTask.evidence || [],
      } : null,
      blocker: status === "blocked" ? {
        classification: "non-waivable-gate",
        reason: "Legacy blocker requires explicit migration-time inspection.",
        blockedAt: found.run.updatedAt,
        waivable: false,
      } : null,
      failureHistory: [],
      assignedWorker: null,
      stateHistory: [{
        sourceSchema: LEGACY_SCHEMA_VERSION,
        sourceStatus: legacyTask.status,
        importedAt: null,
      }],
    };
  });
  const compatibility = {
    projectionVersion: MIGRATION_PROJECTION_VERSION,
    sourceSchema: LEGACY_SCHEMA_VERSION,
    sourceRunId: found.runId,
    sourcePath: normalizeSlashPath(path.relative(found.repoRoot, path.join(found.runRoot, "run.json"))),
    sourceDigest,
    readOnly: true,
    migrationRequired: true,
  };
  return {
    schemaVersion: "run-state/v2",
    runId: found.runId,
    workflow: {
      id: definition.workflowId,
      revision: 1,
      digest: digestWorkflowDefinition(definition),
      definitionPath: null,
    },
    status: projectedStatus,
    createdAt: found.run.createdAt,
    updatedAt: found.run.updatedAt,
    goal: definition.goal,
    execution: definition.execution,
    assurance: definition.assurance,
    checkpointPolicy: definition.checkpointPolicy,
    reviewerPolicy: definition.reviewerPolicy,
    tasks: projectedTasks,
    budget: projectRuntimeBudget(found.run, definition),
    approval: found.run.approval || {
      actor: "legacy-operator",
      approvedAt: found.run.createdAt,
      digest: null,
      source: found.run.source || null,
    },
    reviewer: projectReviewer(found.run),
    reviewHistory: [],
    checkpointReviews: [],
    revisionHistory: [],
    interventions: [],
    interruption: null,
    warnings: [
      ...(found.run.warnings || []),
      "Read-only compatibility projection; explicit backed-up migration is required before workflow execution.",
      "Migration adds the required protected completion allocation without labeling it observed usage.",
    ],
    compatibility,
  };
}

function previewLegacyMigration(repoRoot, runId) {
  const found = findSupervisedRun({ repoRoot, runId });
  const sourcePath = path.join(found.runRoot, "run.json");
  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceDigest = sha256(sourceBytes);
  const definition = projectDefinition(found.run);
  const definitionDigest = digestWorkflowDefinition(definition);
  const migrationDigest = sha256(JSON.stringify({
    projectionVersion: MIGRATION_PROJECTION_VERSION,
    sourceDigest,
    definitionDigest,
  }));
  const projection = projectLegacyRun(found, definition, sourceDigest);
  return {
    found,
    definition,
    definitionDigest,
    migrationDigest,
    projection,
    compatibility: projection.compatibility,
    warnings: projection.warnings,
  };
}

function loadLegacyWorkflowCompatibility(repoRoot, runId) {
  const preview = previewLegacyMigration(repoRoot, runId);
  return {
    repoRoot: preview.found.repoRoot,
    runRoot: preview.found.runRoot,
    runPath: path.join(preview.found.runRoot, "run.json"),
    run: preview.projection,
    definition: preview.definition,
    compatibility: preview.compatibility,
  };
}

function assertMigrationSafe(run) {
  if (ACTIVE_LEGACY_STATUSES.has(run.status) || run.tasks.some((task) => ACTIVE_LEGACY_STATUSES.has(task.status))) {
    throw new Error("Legacy migration requires a safe checkpoint with no active execution or review.");
  }
}

function applyLegacyMigration(repoRoot, runId, options = {}) {
  const preview = previewLegacyMigration(repoRoot, runId);
  const migrationRecordPath = path.join(
    preview.found.repoRoot,
    ".cewp",
    "migrations",
    "supervised-run-v1",
    `${runId}.json`,
  );
  if (fs.existsSync(migrationRecordPath)) {
    throw new Error(`Legacy run ${runId} is already migrated; inspect its migration record.`);
  }
  if (options.expectedDigest !== preview.migrationDigest) {
    throw new Error("Legacy run or projected workflow changed after preview. Preview migration again.");
  }
  assertMigrationSafe(preview.found.run);
  const digestSuffix = preview.compatibility.sourceDigest.slice("sha256:".length, "sha256:".length + 12);
  const backupPath = path.join(
    preview.found.repoRoot,
    ".cewp",
    "migration-backups",
    "supervised-run-v1",
    `${runId}-${digestSuffix}.json`,
  );
  ensureDir(path.dirname(backupPath));
  const sourcePath = path.join(preview.found.runRoot, "run.json");
  if (fs.existsSync(backupPath)) {
    if (!fs.readFileSync(backupPath).equals(fs.readFileSync(sourcePath))) {
      throw new Error("Existing legacy migration backup does not match the approved source bytes.");
    }
  } else {
    fs.copyFileSync(sourcePath, backupPath, fs.constants.COPYFILE_EXCL);
  }
  const created = createApprovedRun({
    repoRoot: preview.found.repoRoot,
    definition: preview.definition,
    expectedDigest: preview.definitionDigest,
    source: {
      kind: "migration",
      path: preview.compatibility.sourcePath,
      sha256: preview.compatibility.sourceDigest,
    },
  });
  const runPath = path.resolve(preview.found.repoRoot, created.runPath);
  const runRoot = path.dirname(runPath);
  const timestamp = new Date().toISOString();
  const run = {
    ...created.run,
    status: preview.projection.status,
    tasks: preview.projection.tasks,
    budget: preview.projection.budget,
    reviewer: preview.projection.reviewer,
    warnings: preview.projection.warnings,
    compatibility: {
      ...preview.compatibility,
      readOnly: false,
      migrationRequired: false,
      migratedAt: timestamp,
      backupPath: normalizeSlashPath(path.relative(preview.found.repoRoot, backupPath)),
    },
  };
  writeJsonAtomic(runPath, run);
  const progress = writeWorkflowProgress(runRoot, run, preview.definition, { now: new Date(timestamp) });
  fs.appendFileSync(path.join(runRoot, "events.jsonl"), `${JSON.stringify({
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "workflow-migrated",
    runId: run.runId,
    sourceRunId: runId,
    sourceSchema: LEGACY_SCHEMA_VERSION,
    sourceDigest: preview.compatibility.sourceDigest,
    definitionDigest: preview.definitionDigest,
    migrationDigest: preview.migrationDigest,
    backupPath: normalizeSlashPath(path.relative(preview.found.repoRoot, backupPath)),
    actor: "operator",
  })}\n`);
  const record = {
    schemaVersion: "workflow-migration/v1",
    projectionVersion: MIGRATION_PROJECTION_VERSION,
    sourceSchema: LEGACY_SCHEMA_VERSION,
    sourceRunId: runId,
    sourceDigest: preview.compatibility.sourceDigest,
    migrationDigest: preview.migrationDigest,
    migratedRunId: run.runId,
    migratedAt: timestamp,
    backupPath: normalizeSlashPath(path.relative(preview.found.repoRoot, backupPath)),
  };
  writeJsonAtomic(migrationRecordPath, record);
  return {
    run,
    definition: preview.definition,
    progress,
    backupPath: normalizeSlashPath(path.relative(preview.found.repoRoot, backupPath)),
    migrationRecordPath: normalizeSlashPath(path.relative(preview.found.repoRoot, migrationRecordPath)),
    definitionPath: created.definitionPath,
  };
}

module.exports = {
  LEGACY_SCHEMA_VERSION,
  MIGRATION_PROJECTION_VERSION,
  applyLegacyMigration,
  loadLegacyWorkflowCompatibility,
  previewLegacyMigration,
};
