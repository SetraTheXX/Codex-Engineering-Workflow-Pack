"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ensureDir } = require("../lib/fs");
const { normalizeSlashPath } = require("../lib/paths");
const { digestWorkflowDefinition } = require("./definition");

const RUN_STATE_SCHEMA_VERSION = "run-state/v2";

function timestampId(date) {
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3),
  ].join("");
}

function allocateRunId(repoRoot, workflowId, now) {
  const runsRoot = path.join(repoRoot, ".cewp", "workflow-runs");
  const base = `${workflowId}-${timestampId(now)}`;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const runId = attempt === 0 ? base : `${base}-${attempt}`;
    if (!fs.existsSync(path.join(runsRoot, runId))) return runId;
  }
  throw new Error("Could not allocate a unique workflow run id.");
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function persistApprovedDefinition(repoRoot, definition, digest) {
  const definitionsRoot = path.join(
    repoRoot,
    ".cewp",
    "workflows",
    definition.workflowId,
    "definitions",
  );
  const definitionPath = path.join(
    definitionsRoot,
    `revision-${String(definition.revision.number).padStart(6, "0")}.json`,
  );
  if (fs.existsSync(definitionPath)) {
    const existing = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
    if (digestWorkflowDefinition(existing) !== digest) {
      throw new Error(`Workflow revision ${definition.revision.number} already exists with different content.`);
    }
  } else {
    writeJsonAtomic(definitionPath, definition);
  }
  return definitionPath;
}

function makeRuntimeBudget(budget) {
  return {
    ...budget,
    consumed: {
      modelOperations: 0,
      allocations: Object.fromEntries(Object.keys(budget.allocations).map((name) => [name, 0])),
      targetedVerificationRuns: 0,
      fullVerificationRuns: 0,
      capturedOutputBytes: 0,
    },
    thresholdEvents: [],
    revisions: [],
    hostLimit: null,
    pauseReason: null,
  };
}

function createApprovedRun(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const now = options.now || new Date();
  const timestamp = now.toISOString();
  const digest = digestWorkflowDefinition(options.definition);
  if (options.expectedDigest !== digest) {
    throw new Error("Workflow proposal changed after preview. Run `cewp workflow propose` again and approve its digest.");
  }
  const definitionPath = persistApprovedDefinition(repoRoot, options.definition, digest);
  const runId = allocateRunId(repoRoot, options.definition.workflowId, now);
  const runRoot = path.join(repoRoot, ".cewp", "workflow-runs", runId);
  const runPath = path.join(runRoot, "run.json");
  const run = {
    schemaVersion: RUN_STATE_SCHEMA_VERSION,
    runId,
    workflow: {
      id: options.definition.workflowId,
      revision: options.definition.revision.number,
      digest,
      definitionPath: normalizeSlashPath(path.relative(repoRoot, definitionPath)),
    },
    status: "approved",
    createdAt: timestamp,
    updatedAt: timestamp,
    goal: options.definition.goal,
    execution: options.definition.execution,
    assurance: options.definition.assurance,
    checkpointPolicy: options.definition.checkpointPolicy,
    reviewerPolicy: options.definition.reviewerPolicy,
    tasks: options.definition.tasks.map((task) => ({
      id: task.id,
      status: task.dependsOn.length === 0 ? "ready" : "pending",
      attempts: 0,
      activeCheckpointId: null,
      resultId: null,
      verification: null,
      blocker: null,
    })),
    budget: makeRuntimeBudget(options.definition.budget),
    approval: {
      actor: "operator",
      approvedAt: timestamp,
      digest,
      source: options.source,
    },
    reviewer: {
      status: options.definition.reviewerPolicy.requiredForFinalize ? "pending" : "not-required",
      decision: null,
    },
    interventions: [],
  };
  writeJsonAtomic(runPath, run);
  fs.writeFileSync(path.join(runRoot, "events.jsonl"), `${JSON.stringify({
    schemaVersion: "workflow-event/v1",
    timestamp,
    type: "workflow-approved",
    runId,
    workflowId: options.definition.workflowId,
    revision: options.definition.revision.number,
    digest,
    actor: "operator",
  })}\n`, { flag: "wx" });
  return {
    run,
    definitionPath: normalizeSlashPath(path.relative(repoRoot, definitionPath)),
    runPath: normalizeSlashPath(path.relative(repoRoot, runPath)),
  };
}

module.exports = {
  RUN_STATE_SCHEMA_VERSION,
  createApprovedRun,
  writeJsonAtomic,
};
