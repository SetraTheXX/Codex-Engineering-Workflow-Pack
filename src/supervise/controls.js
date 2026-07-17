"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateVerificationCommand } = require("./commands");
const { isCheckpointSafe } = require("./budget");
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
const ALLOCATIONS = Object.freeze(["implementation", "repair", "reviewer", "finalization"]);

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
  if (!["proposed", "approved"].includes(found.run.status) || task.attempts.length > 0) {
    throw new Error("Phase 9 can revise only an unstarted checkpoint; completed evidence is never rewritten.");
  }
  const fields = {
    goal: options.goal,
    scopes: options.scopes,
    verification: options.verificationCommands,
    fullVerification: options.fullVerificationCommands,
    stoppingConditions: options.stoppingConditions,
  };
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
  if (targeted.length * 2 > found.run.budget.maxTargetedVerificationRuns.value) {
    throw new Error("Revised targeted verification exceeds the approved baseline/post-check budget.");
  }
  if (full.length > found.run.budget.maxFullVerificationRuns.value) {
    throw new Error("Revised full verification exceeds the approved budget.");
  }

  const timestamp = new Date().toISOString();
  const goal = fields.goal ? String(fields.goal).trim() : found.run.goal;
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
  const previousCeiling = budget.modelOperations.value;
  budget.modelOperations.value += options.operations;
  budget.allocations[options.allocation].value += options.operations;
  budget.revisions.push({
    revisedAt: timestamp,
    actor: "operator",
    operationsAdded: options.operations,
    allocation: options.allocation,
    previousCeiling,
    ceiling: budget.modelOperations.value,
  });
  const allocationTotal = Object.values(budget.allocations)
    .reduce((total, entry) => total + entry.value, 0);
  if (allocationTotal !== budget.modelOperations.value) {
    throw new Error("Budget revision would break allocation/ceiling consistency.");
  }
  const run = { ...found.run, updatedAt: timestamp, budget };
  writeCanonicalRun(found.runRoot, run);
  event(found, "budget-expanded", timestamp, {
    operationsAdded: options.operations,
    allocation: options.allocation,
    previousCeiling,
    ceiling: budget.modelOperations.value,
  });
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

function terminalControl(options, status) {
  if (!options.yes) throw new Error(`${status} requires --yes.`);
  const found = findSupervisedRun(options);
  if (found.run.status === "completed") throw new Error("Completed run cannot be changed.");
  const timestamp = new Date().toISOString();
  const run = {
    ...found.run,
    status,
    updatedAt: timestamp,
    tasks: found.run.tasks.map((task) => (
      task.status === "completed" ? task : { ...task, status }
    )),
  };
  updateOwnershipTerminal(found.runRoot, "abandoned", timestamp);
  writeCanonicalRun(found.runRoot, run);
  event(found, `run-${status}`, timestamp, { reason: options.reason || null });
  return result(found, run);
}

function blockSupervisedRun(options = {}) {
  if (!options.reason) throw new Error("block requires --reason.");
  const value = terminalControl({ ...options, yes: true }, "blocked");
  value.run.tasks[0].blocker = {
    code: "operator-blocked",
    reasons: [options.reason],
    actions: ["revise", "rollback", "abandon"],
  };
  writeCanonicalRun(value.runRoot, value.run);
  return value;
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
  resumeSupervisedRun,
  reviseSupervisedRun,
  runSupervisedControl,
};
