"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getGitOutput } = require("../lib/git");
const { readJsonFile } = require("../lib/json");
const { normalizeComparePath } = require("../lib/paths");
const { isWorkerRuntimeOutputPath } = require("../lib/scope-check");
const { assertPolicyAllows } = require("../run/policy");
const { validateOwnershipRecord } = require("../run/ownership");
const { validateVerificationCommand } = require("./commands");
const { isCheckpointSafe } = require("./budget");
const { assertVerificationScheduleFits } = require("./profiles");
const {
  appendEvent,
  findSupervisedRun,
  getNextAction,
  normalizeScope,
  writeCanonicalRun,
} = require("./state");

const PAUSE_REASONS = Object.freeze({
  "budget-safe": "paused-budget-safe",
  "budget-unverified": "paused-budget-unverified",
  "host-limit": "paused-host-limit",
});
const MODEL_ALLOCATIONS = Object.freeze(["implementation", "repair", "reviewer", "finalization"]);
const LOCAL_VERIFICATION_ALLOCATIONS = Object.freeze({
  "targeted-verification": "maxTargetedVerificationRuns",
  "full-verification": "maxFullVerificationRuns",
});
const ALLOCATIONS = Object.freeze([
  ...MODEL_ALLOCATIONS,
  ...Object.keys(LOCAL_VERIFICATION_ALLOCATIONS),
]);

function runManagedGit(args, worktreePath, label) {
  const result = getGitOutput(args, worktreePath);
  if (result.status !== 0) {
    throw new Error(`Managed checkpoint failed during ${label}: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result;
}

function writeOwnership(runRoot, ownership) {
  const ownershipPath = path.join(runRoot, "ownership.json");
  const temporaryPath = `${ownershipPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(ownership, null, 2)}\n`);
  fs.renameSync(temporaryPath, ownershipPath);
}

function validateOwnedRunWorktree(found, ownership) {
  if (!fs.existsSync(ownership.worktree.path) || !fs.statSync(ownership.worktree.path).isDirectory()) {
    throw new Error(`Managed checkpoint worktree is missing: ${ownership.worktree.path}`);
  }
  const actualPath = fs.realpathSync.native(ownership.worktree.path);
  const expectedRoot = path.resolve(
    found.repoRoot,
    "..",
    ".cewp-worktrees",
    path.basename(found.repoRoot),
    found.runId,
  );
  const expectedRealRoot = fs.realpathSync.native(expectedRoot);
  if (normalizeComparePath(path.dirname(actualPath)) !== normalizeComparePath(expectedRealRoot)) {
    throw new Error("Managed ownership path is outside the expected CEWP run worktree root.");
  }
  return actualPath;
}

function sealVerifiedCheckpoint(found, task, timestamp) {
  const ownership = validateOwnershipRecord(
    readJsonFile(path.join(found.runRoot, "ownership.json"), "execution ownership"),
  );
  if (
    ownership.runId !== found.runId
    || ownership.taskId !== task.id
    || ownership.checkpointId !== task.id
    || ownership.status !== "verified"
  ) {
    throw new Error("A completed checkpoint can advance only from matching verified ownership.");
  }
  const worktreePath = validateOwnedRunWorktree(found, ownership);
  const expectedHead = task.baseCommit || found.run.repo.baseCommit;
  const currentHead = runManagedGit(["rev-parse", "HEAD"], worktreePath, "snapshot HEAD inspection").stdout.trim();
  if (currentHead !== expectedHead) {
    throw new Error("Managed checkpoint HEAD changed outside the supervised snapshot lifecycle.");
  }

  runManagedGit(["add", "-A", "--", "."], worktreePath, "snapshot staging");
  const stagedRuntimePaths = runManagedGit(
    ["diff", "--cached", "--name-only", "-z"],
    worktreePath,
    "snapshot staging inspection",
  ).stdout.split("\0").filter((file) => file && isWorkerRuntimeOutputPath(file));
  if (stagedRuntimePaths.length > 0) {
    runManagedGit(
      ["reset", "HEAD", "--", ...stagedRuntimePaths],
      worktreePath,
      "runtime output unstaging",
    );
  }
  runManagedGit([
    "-c", "user.name=CEWP Core",
    "-c", "user.email=cewp-core@example.invalid",
    "-c", "commit.gpgSign=false",
    "commit", "--allow-empty", "--no-verify", "-m", `cewp: seal ${task.id}`,
  ], worktreePath, "snapshot commit");
  const commit = runManagedGit(["rev-parse", "HEAD"], worktreePath, "snapshot identity").stdout.trim();
  const releasedOwnership = {
    ...ownership,
    status: "released",
    releasedAt: timestamp,
  };
  writeOwnership(found.runRoot, releasedOwnership);
  return {
    commit,
    sealedAt: timestamp,
    worktreePath,
    ownership: releasedOwnership,
  };
}

function requireNextCheckpoint(fields) {
  if (
    !fields.goal
    || fields.scopes.length === 0
    || fields.verification.length === 0
    || fields.stoppingConditions.length === 0
  ) {
    throw new Error("Advancing a completed checkpoint requires --goal, --scope, --verify, and --stop for the next bounded checkpoint.");
  }
}

function nextCheckpoint(task, fields, snapshot, number) {
  const targeted = fields.verification.map((value) => String(value).trim());
  const full = fields.fullVerification.map((value) => String(value).trim());
  return {
    id: `checkpoint-${number}`,
    title: String(fields.goal).trim(),
    baseCommit: snapshot.commit,
    status: "proposed",
    allowedFiles: fields.scopes.map(normalizeScope),
    forbiddenFiles: [...task.forbiddenFiles],
    stoppingConditions: fields.stoppingConditions.map((value) => String(value).trim()),
    verification: {
      baseline: [],
      targeted,
      full,
      runs: [],
      failures: [],
      latest: null,
      scope: { status: "pending", warnings: [] },
    },
    attempts: [],
    evidence: [],
    blocker: null,
  };
}

function advanceCompletedCheckpoint(found, fields) {
  requireNextCheckpoint(fields);
  const task = found.run.tasks[0];
  const targeted = fields.verification.map((value) => String(value).trim());
  const full = fields.fullVerification.map((value) => String(value).trim());
  targeted.forEach(validateVerificationCommand);
  full.forEach(validateVerificationCommand);
  assertVerificationScheduleFits(found.run.budget, targeted.length, full.length);

  const timestamp = new Date().toISOString();
  const snapshot = sealVerifiedCheckpoint(found, task, timestamp);
  const history = Array.isArray(found.run.checkpointHistory) ? found.run.checkpointHistory : [];
  const archived = {
    ...task,
    status: "completed",
    completedAt: timestamp,
    snapshot: {
      commit: snapshot.commit,
      sealedAt: timestamp,
    },
    ownership: {
      schemaVersion: snapshot.ownership.schemaVersion,
      owner: snapshot.ownership.owner,
      backend: snapshot.ownership.backend,
      taskId: snapshot.ownership.taskId,
      checkpointId: snapshot.ownership.checkpointId,
      status: snapshot.ownership.status,
      worktreeId: snapshot.ownership.worktree.id,
    },
  };
  const next = nextCheckpoint(task, fields, snapshot, history.length + 2);
  const remainsPaused = found.run.status === "paused-budget-safe";
  const run = {
    ...found.run,
    status: remainsPaused ? found.run.status : "proposed",
    planRevision: found.run.planRevision + 1,
    updatedAt: timestamp,
    approval: null,
    checkpointHistory: [...history, archived],
    tasks: [next],
    reviewer: {
      required: true,
      independent: true,
      status: "pending",
      decision: null,
    },
    receipt: null,
    ...(remainsPaused ? {
      pause: {
        ...found.run.pause,
        previousRunStatus: "proposed",
        previousTaskStatus: "proposed",
        planRevisedAt: timestamp,
      },
    } : { pause: null }),
  };
  writeCanonicalRun(found.runRoot, run);
  event(found, "checkpoint-snapshot-created", timestamp, {
    checkpointId: task.id,
    snapshotCommit: snapshot.commit,
  });
  event(found, "plan-revised", timestamp, {
    previousPlanRevision: found.run.planRevision,
    planRevision: run.planRevision,
    completedCheckpointId: task.id,
    nextCheckpointId: next.id,
    changedFields: ["goal", "scopes", "verification", ...(full.length > 0 ? ["fullVerification"] : []), "stoppingConditions"],
  });
  return result(found, run);
}

function result(found, run, extra = {}) {
  return {
    run,
    runRoot: found.runRoot,
    nextAction: getNextAction(run),
    ...extra,
  };
}

function event(found, type, timestamp, detail = {}) {
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp,
    type,
    runId: found.runId,
    actor: "operator",
    ...detail,
  });
}

function reviseSupervisedRun(options = {}) {
  const found = findSupervisedRun(options);
  const task = found.run.tasks[0];
  const pausedAfterCompletion = found.run.status === "paused-budget-safe"
    && found.run.pause
    && found.run.pause.previousRunStatus === "checkpoint-complete"
    && task.status === "verified";
  const completedCheckpoint = found.run.status === "checkpoint-complete" && task.status === "verified";
  const fields = {
    goal: options.goal,
    scopes: options.scopes,
    verification: options.verificationCommands,
    fullVerification: options.fullVerificationCommands,
    stoppingConditions: options.stoppingConditions,
  };
  if (pausedAfterCompletion || completedCheckpoint) {
    return advanceCompletedCheckpoint(found, fields);
  }
  if (!["proposed", "approved"].includes(found.run.status) || task.attempts.length > 0) {
    throw new Error("Phase 9 can revise only an unstarted checkpoint; completed evidence is never rewritten.");
  }
  if (
    !fields.goal
    && fields.scopes.length === 0
    && fields.verification.length === 0
    && fields.fullVerification.length === 0
    && fields.stoppingConditions.length === 0
  ) {
    throw new Error("revise requires at least one new goal, scope, verification command, or stopping condition.");
  }
  const targeted = fields.verification.length > 0
    ? fields.verification.map((value) => String(value).trim())
    : task.verification.targeted;
  const full = fields.fullVerification.length > 0
    ? fields.fullVerification.map((value) => String(value).trim())
    : task.verification.full;
  targeted.forEach(validateVerificationCommand);
  full.forEach(validateVerificationCommand);
  assertVerificationScheduleFits(found.run.budget, targeted.length, full.length);

  const timestamp = new Date().toISOString();
  const hasCompletedCheckpoints = Array.isArray(found.run.checkpointHistory)
    && found.run.checkpointHistory.length > 0;
  const goal = fields.goal && !hasCompletedCheckpoints
    ? String(fields.goal).trim()
    : found.run.goal;
  const run = {
    ...found.run,
    goal,
    status: "proposed",
    planRevision: found.run.planRevision + 1,
    updatedAt: timestamp,
    approval: null,
    tasks: [{
      ...task,
      title: fields.goal ? goal : task.title,
      status: "proposed",
      allowedFiles: fields.scopes.length > 0 ? fields.scopes.map(normalizeScope) : task.allowedFiles,
      stoppingConditions: fields.stoppingConditions.length > 0
        ? fields.stoppingConditions.map((value) => String(value).trim())
        : task.stoppingConditions,
      verification: {
        ...task.verification,
        targeted,
        full,
      },
    }],
  };
  writeCanonicalRun(found.runRoot, run);
  event(found, "plan-revised", timestamp, {
    previousPlanRevision: found.run.planRevision,
    planRevision: run.planRevision,
    changedFields: Object.entries(fields)
      .filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value))
      .map(([name]) => name),
  });
  return result(found, run);
}

function pauseSupervisedRun(options = {}) {
  if (!options.yes) throw new Error("pause requires --yes.");
  const found = findSupervisedRun(options);
  const pauseStatus = PAUSE_REASONS[options.reason];
  if (!pauseStatus) {
    throw new Error(`pause --reason requires one of: ${Object.keys(PAUSE_REASONS).join(", ")}.`);
  }
  const safe = isCheckpointSafe(found.run);
  if (pauseStatus === "paused-budget-safe" && !safe) {
    throw new Error("paused-budget-safe requires a verified or not-yet-started checkpoint.");
  }
  if (pauseStatus === "paused-budget-unverified" && safe) {
    throw new Error("paused-budget-unverified requires partial unverified checkpoint work.");
  }
  if (["completed", "cancelled", "abandoned"].includes(found.run.status)) {
    throw new Error(`Cannot pause terminal run status ${found.run.status}.`);
  }
  const timestamp = new Date().toISOString();
  const budget = JSON.parse(JSON.stringify(found.run.budget));
  if (pauseStatus === "paused-host-limit") {
    budget.hostLimit = {
      active: true,
      source: "operator",
      observedAt: timestamp,
      detail: options.note || null,
    };
  }
  const run = {
    ...found.run,
    status: pauseStatus,
    updatedAt: timestamp,
    budget,
    pause: {
      status: pauseStatus,
      reason: options.reason,
      note: options.note || null,
      pausedAt: timestamp,
      previousRunStatus: found.run.status,
      previousTaskStatus: found.run.tasks[0].status,
      actions: ["add-budget", "reduce-scope", "resume-later", "rollback", "abandon"],
    },
  };
  writeCanonicalRun(found.runRoot, run);
  event(found, pauseStatus, timestamp, { reason: options.reason, note: options.note || null });
  return result(found, run);
}

function resumeSupervisedRun(options = {}) {
  if (!options.yes) throw new Error("resume requires --yes.");
  const found = findSupervisedRun(options);
  if (!found.run.status.startsWith("paused-") || !found.run.pause) {
    throw new Error(`Run ${found.runId} is not paused.`);
  }
  const timestamp = new Date().toISOString();
  const budget = JSON.parse(JSON.stringify(found.run.budget));
  if (found.run.status === "paused-host-limit") budget.hostLimit = null;
  const run = {
    ...found.run,
    status: found.run.pause.previousRunStatus,
    updatedAt: timestamp,
    budget,
    pause: {
      ...found.run.pause,
      status: "resumed",
      resumedAt: timestamp,
    },
  };
  writeCanonicalRun(found.runRoot, run);
  event(found, "run-resumed", timestamp, { resumedFrom: found.run.status });
  return result(found, run);
}

function addSupervisedBudget(options = {}) {
  if (!options.yes) throw new Error("add-budget requires --yes.");
  const found = findSupervisedRun(options);
  if (["completed", "cancelled", "abandoned"].includes(found.run.status)) {
    throw new Error(`Cannot expand budget for terminal run status ${found.run.status}.`);
  }
  if (!Number.isInteger(options.operations) || options.operations <= 0 || options.operations > 100) {
    throw new Error("--operations requires an integer from 1 to 100.");
  }
  if (!ALLOCATIONS.includes(options.allocation)) {
    throw new Error(`--allocation requires one of: ${ALLOCATIONS.join(", ")}.`);
  }
  const timestamp = new Date().toISOString();
  const budget = JSON.parse(JSON.stringify(found.run.budget));
  const localBudgetField = LOCAL_VERIFICATION_ALLOCATIONS[options.allocation];
  let detail;
  if (localBudgetField) {
    const previousLimit = budget[localBudgetField].value;
    budget[localBudgetField].value += options.operations;
    detail = {
      budgetKind: "local-verification",
      checksAdded: options.operations,
      allocation: options.allocation,
      previousLimit,
      limit: budget[localBudgetField].value,
    };
  } else {
    const previousCeiling = budget.modelOperations.value;
    budget.modelOperations.value += options.operations;
    budget.allocations[options.allocation].value += options.operations;
    const allocationTotal = Object.values(budget.allocations)
      .reduce((total, entry) => total + entry.value, 0);
    if (allocationTotal !== budget.modelOperations.value) {
      throw new Error("Budget revision would break allocation/ceiling consistency.");
    }
    detail = {
      budgetKind: "model-operations",
      operationsAdded: options.operations,
      allocation: options.allocation,
      previousCeiling,
      ceiling: budget.modelOperations.value,
    };
  }
  budget.revisions.push({ revisedAt: timestamp, actor: "operator", ...detail });
  const run = { ...found.run, updatedAt: timestamp, budget };
  writeCanonicalRun(found.runRoot, run);
  event(found, "budget-expanded", timestamp, detail);
  return result(found, run);
}

function updateOwnershipTerminal(runRoot, status, timestamp) {
  const ownershipPath = path.join(runRoot, "ownership.json");
  if (!fs.existsSync(ownershipPath)) return;
  const ownership = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
  const temporaryPath = `${ownershipPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ ...ownership, status, updatedAt: timestamp }, null, 2)}\n`);
  fs.renameSync(temporaryPath, ownershipPath);
}

function rollbackSupervisedRun(options = {}) {
  if (!options.yes) throw new Error("rollback requires --yes.");
  const found = findSupervisedRun(options);
  if (["completed", "cancelled", "abandoned", "rolled-back"].includes(found.run.status)) {
    throw new Error(`Cannot roll back terminal run status ${found.run.status}.`);
  }
  assertPolicyAllows(found.repoRoot, "runCommands");
  const ownershipPath = path.join(found.runRoot, "ownership.json");
  const ownership = validateOwnershipRecord(readJsonFile(ownershipPath, "execution ownership"));
  const taskId = found.run.tasks[0].id;
  const history = Array.isArray(found.run.checkpointHistory) ? found.run.checkpointHistory : [];
  const releasedCheckpoint = history.find((checkpoint) => checkpoint.id === ownership.checkpointId);
  if (
    ownership.runId !== found.runId
    || (
      (ownership.taskId !== taskId || ownership.checkpointId !== taskId)
      && !(ownership.status === "released" && releasedCheckpoint)
    )
  ) {
    throw new Error("Rollback ownership identity does not match the canonical run and checkpoint.");
  }
  if (ownership.owner !== "managed" || ownership.backend !== "codex-exec") {
    throw new Error("Rollback requires managed/codex-exec ownership.");
  }
  if (!["active", "verified", "released"].includes(ownership.status)) {
    throw new Error(`Rollback requires active, verified, or checkpoint-released ownership; current status is ${ownership.status}.`);
  }
  const actualRealPath = validateOwnedRunWorktree(found, ownership);

  const before = runManagedGit(["status", "--short"], actualRealPath, "rollback change inspection").stdout
    .split(/\r?\n/)
    .filter(Boolean);
  runManagedGit(["reset", "--hard", found.run.repo.baseCommit], actualRealPath, "tracked rollback");
  runManagedGit(["clean", "-fd"], actualRealPath, "untracked rollback cleanup");
  const after = runManagedGit(["status", "--porcelain"], actualRealPath, "rollback cleanliness verification");
  if (after.stdout.trim()) {
    throw new Error("Managed rollback did not return the isolated worktree to a clean state.");
  }

  const timestamp = new Date().toISOString();
  updateOwnershipTerminal(found.runRoot, "rolled-back", timestamp);
  const run = {
    ...found.run,
    status: "rolled-back",
    updatedAt: timestamp,
    tasks: found.run.tasks.map((task) => ({ ...task, status: "rolled-back" })),
  };
  writeCanonicalRun(found.runRoot, run);
  event(found, "run-rolled-back", timestamp, {
    baseCommit: found.run.repo.baseCommit,
    priorChangeEntries: before.length,
  });
  return result(found, run);
}

function terminalControl(options, status) {
  if (!options.yes) throw new Error(`${status} requires --yes.`);
  const found = findSupervisedRun(options);
  if (["completed", "cancelled", "abandoned", "rolled-back"].includes(found.run.status)) {
    throw new Error(`Terminal run status ${found.run.status} cannot be changed.`);
  }
  const timestamp = new Date().toISOString();
  const run = {
    ...found.run,
    status,
    updatedAt: timestamp,
    tasks: found.run.tasks.map((task) => (
      task.status === "completed" ? task : { ...task, status }
    )),
  };
  updateOwnershipTerminal(found.runRoot, status, timestamp);
  writeCanonicalRun(found.runRoot, run);
  event(found, `run-${status}`, timestamp, { reason: options.reason || null });
  return result(found, run);
}

function blockSupervisedRun(options = {}) {
  if (!options.reason) throw new Error("block requires --reason.");
  const found = findSupervisedRun(options);
  if (["completed", "cancelled", "abandoned", "rolled-back"].includes(found.run.status)) {
    throw new Error(`Terminal run status ${found.run.status} cannot be blocked.`);
  }
  const timestamp = new Date().toISOString();
  const run = {
    ...found.run,
    status: "blocked",
    updatedAt: timestamp,
    tasks: found.run.tasks.map((task) => ({
      ...task,
      status: "blocked",
      blocker: {
        code: "operator-blocked",
        reasons: [options.reason],
        actions: ["revise", "rollback", "abandon"],
      },
    })),
  };
  writeCanonicalRun(found.runRoot, run);
  event(found, "run-blocked", timestamp, { reason: options.reason });
  return result(found, run);
}

function continueSupervisedRun(options = {}) {
  const found = findSupervisedRun(options);
  if (found.run.status !== "checkpoint-complete" || found.run.tasks[0].status !== "verified") {
    throw new Error("continue requires a verified checkpoint.");
  }
  const timestamp = new Date().toISOString();
  event(found, "operator-continued", timestamp, { next: "independent-review" });
  return result(found, found.run);
}

function reassignSupervisedRun(options = {}) {
  const found = findSupervisedRun(options);
  const timestamp = new Date().toISOString();
  event(found, "reassign-unavailable", timestamp, {
    owner: found.run.execution.owner,
    backend: found.run.execution.backend,
    reason: "Phase 9 golden path is fixed to managed/codex-exec.",
  });
  return result(found, found.run, {
    supported: false,
    reason: "Phase 9 golden path is fixed to managed/codex-exec; no second backend is shipped.",
  });
}

function runSupervisedControl(options = {}) {
  if (options.subcommand === "revise") return reviseSupervisedRun(options);
  if (options.subcommand === "pause") return pauseSupervisedRun(options);
  if (options.subcommand === "resume") return resumeSupervisedRun(options);
  if (options.subcommand === "add-budget") return addSupervisedBudget(options);
  if (options.subcommand === "rollback") return rollbackSupervisedRun(options);
  if (options.subcommand === "cancel") return terminalControl(options, "cancelled");
  if (options.subcommand === "abandon") return terminalControl(options, "abandoned");
  if (options.subcommand === "block") return blockSupervisedRun(options);
  if (options.subcommand === "continue") return continueSupervisedRun(options);
  if (options.subcommand === "reassign") return reassignSupervisedRun(options);
  throw new Error(`Unsupported supervised control: ${options.subcommand}.`);
}

module.exports = {
  addSupervisedBudget,
  pauseSupervisedRun,
  rollbackSupervisedRun,
  resumeSupervisedRun,
  reviseSupervisedRun,
  runSupervisedControl,
};
