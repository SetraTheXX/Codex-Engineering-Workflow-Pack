"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getGitOutput } = require("../lib/git");
const { readJsonFile, writeJson } = require("../lib/json");
const { normalizeSlashPath, validateRunId } = require("../lib/paths");
const {
  makeBudgetEnvelope,
  makeUsagePreview,
  validateProfile,
  validateTestAuthoring,
} = require("./profiles");
const { validateVerificationCommand } = require("./commands");

const SUPERVISED_RUN_SCHEMA_VERSION = "supervised-run/v1";

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function formatRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join("-");
}

function getSupervisedRunsRoot(repoRoot = process.cwd()) {
  return path.join(path.resolve(repoRoot), ".cewp", "supervised-runs");
}

function findSupervisedRun(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const runsRoot = getSupervisedRunsRoot(repoRoot);
  let runId = options.runId;

  if (!runId) {
    if (!fs.existsSync(runsRoot)) {
      throw new Error(`No supervised CEWP runs found under: ${runsRoot}`);
    }
    const runIds = fs.readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    runId = runIds.at(-1);
    if (!runId) {
      throw new Error(`No supervised CEWP runs found under: ${runsRoot}`);
    }
  }

  validateRunId(runId);
  const runRoot = path.join(runsRoot, runId);
  const runPath = path.join(runRoot, "run.json");
  if (!fs.existsSync(runPath)) {
    throw new Error(`Supervised CEWP run not found: ${runId}`);
  }
  const run = readJsonFile(runPath, "supervised run");
  if (run.schemaVersion !== SUPERVISED_RUN_SCHEMA_VERSION || run.runId !== runId) {
    throw new Error(`Invalid supervised run contract: ${runPath}`);
  }
  return { repoRoot, runId, runRoot, run };
}

function nextRunId(repoRoot, now = new Date()) {
  const runsRoot = getSupervisedRunsRoot(repoRoot);
  let candidate = new Date(now);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const runId = formatRunId(candidate);
    if (!fs.existsSync(path.join(runsRoot, runId))) {
      return runId;
    }
    candidate = new Date(candidate.getTime() + 1000);
  }

  throw new Error("Could not allocate a unique supervised run id.");
}

function normalizeScope(value) {
  const normalized = normalizeSlashPath(requiredText(value, "--scope")).replace(/^\.\//, "");
  if (
    path.posix.isAbsolute(normalized)
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("/../")
    || normalized === ".git"
    || normalized.startsWith(".git/")
  ) {
    throw new Error(`Unsafe supervised scope: ${value}. Use a repository-relative path.`);
  }
  return normalized;
}

function requireList(values, optionName) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${optionName} is required at least once.`);
  }
  return values.map((value) => requiredText(value, optionName));
}

function readBaseCommit(repoRoot) {
  const result = getGitOutput(["rev-parse", "HEAD"], repoRoot);
  if (result.status !== 0) {
    throw new Error(`Supervised runs require a Git repository with an initial commit: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout.trim();
}

function renderProgress(run) {
  const task = run.tasks[0];
  const nextAction = getNextAction(run);
  const latestVerification = task.verification && task.verification.latest;
  const blocker = task.blocker;
  return `# CEWP Supervised Progress

- Run: ${run.runId}
- Status: ${run.status}
- Goal: ${run.goal}
- Plan revision: ${run.planRevision}
- Execution: ${run.execution.owner} / ${run.execution.backend}
- Assurance: ${run.assurance.profile}
- Test authoring: ${run.assurance.testAuthoring}
- Current checkpoint: ${task.id} (${task.status})
- Attempts: ${task.attempts.length}
- Latest verification: ${latestVerification ? `${latestVerification.stage} ${latestVerification.status}` : "none"}
- Blockers: ${blocker ? blocker.code : "none"}
- Next safe action: ${nextAction.summary}

This file is generated from canonical state. Editing it does not change the run.
`;
}

function getNextAction(run) {
  if (run.status === "proposed") {
    return {
      action: "approve",
      command: `cewp supervise approve ${run.runId} --yes`,
      summary: "approve the proposed run",
    };
  }
  if (run.status === "approved" && run.tasks[0].status === "ready") {
    return {
      action: "execute",
      command: `cewp supervise execute ${run.runId} --yes`,
      summary: "execute checkpoint-1",
    };
  }
  if (run.status === "verifying" && run.tasks[0].status === "awaiting-verification") {
    return {
      action: "verify",
      command: `cewp supervise verify ${run.runId}`,
      summary: "run targeted verification for checkpoint-1",
    };
  }
  if (run.status === "checkpoint-complete" && run.tasks[0].status === "verified") {
    return {
      action: "review",
      command: `cewp supervise review ${run.runId} --yes`,
      summary: "run the independent reviewer",
    };
  }
  if (run.status === "needs-repair" && run.tasks[0].status === "repair-ready") {
    return {
      action: "retry",
      command: `cewp supervise retry ${run.runId} --yes`,
      summary: "dispatch one bounded repair attempt",
    };
  }
  if (run.status === "blocked") {
    return {
      action: "inspect-blocker",
      command: `cewp supervise status ${run.runId}`,
      summary: "inspect blocker and choose retry, revise, rollback, or abandon",
    };
  }
  return {
    action: "inspect",
    command: `cewp supervise status ${run.runId}`,
    summary: "inspect canonical state",
  };
}

function writeCanonicalRun(runRoot, run) {
  const runPath = path.join(runRoot, "run.json");
  const temporaryPath = `${runPath}.tmp-${process.pid}`;
  writeJson(temporaryPath, run);
  fs.renameSync(temporaryPath, runPath);
  fs.writeFileSync(path.join(runRoot, "progress.md"), renderProgress(run));
}

function appendEvent(runRoot, event) {
  fs.appendFileSync(
    path.join(runRoot, "events.jsonl"),
    `${JSON.stringify(event)}\n`,
  );
}

function createProposedRun(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const goal = requiredText(options.goal, "--goal");
  const scopes = requireList(options.scopes, "--scope").map(normalizeScope);
  const verification = requireList(options.verificationCommands, "--verify");
  const stoppingConditions = requireList(options.stoppingConditions, "--stop");
  const assuranceProfile = options.assurance || "standard";
  const testAuthoring = options.testAuthoring || "auto";
  validateProfile(assuranceProfile);
  validateTestAuthoring(testAuthoring);
  verification.forEach(validateVerificationCommand);
  const previewBudget = makeBudgetEnvelope(assuranceProfile);
  if (verification.length * 2 > previewBudget.maxTargetedVerificationRuns.value) {
    throw new Error("Approved targeted verification budget must cover both baseline and post-change checks.");
  }

  const createdAt = new Date().toISOString();
  const runId = nextRunId(repoRoot);
  const runRoot = path.join(getSupervisedRunsRoot(repoRoot), runId);
  const run = {
    schemaVersion: SUPERVISED_RUN_SCHEMA_VERSION,
    runId,
    createdAt,
    updatedAt: createdAt,
    repo: {
      root: repoRoot,
      baseCommit: readBaseCommit(repoRoot),
    },
    source: {
      kind: "direct-goal",
      path: null,
    },
    goal,
    mode: "supervised",
    status: "proposed",
    planRevision: 1,
    execution: {
      owner: "managed",
      backend: "codex-exec",
      worktreeOwner: "cewp-core",
    },
    assurance: {
      profile: assuranceProfile,
      testAuthoring,
      productionVerificationClaimAllowed: assuranceProfile !== "prototype",
    },
    budget: previewBudget,
    usage: makeUsagePreview(),
    tasks: [
      {
        id: "checkpoint-1",
        title: goal,
        status: "proposed",
        allowedFiles: scopes,
        forbiddenFiles: [".git/**", ".cewp/**"],
        stoppingConditions,
        verification: {
          baseline: [],
          targeted: verification,
          full: [],
          runs: [],
          failures: [],
          latest: null,
          scope: { status: "pending", warnings: [] },
        },
        attempts: [],
        evidence: [],
        blocker: null,
      },
    ],
    approval: null,
    reviewer: {
      required: true,
      decision: null,
    },
    warnings: [
      "Managed token usage is unavailable until a structured Codex turn completes.",
      "Host-internal usage and ChatGPT plan impact remain unknown.",
    ],
  };

  fs.mkdirSync(runRoot, { recursive: true });
  writeJson(path.join(runRoot, "run.json"), run);
  fs.writeFileSync(path.join(runRoot, "events.jsonl"), "");
  appendEvent(runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: createdAt,
    type: "run-proposed",
    runId,
    planRevision: 1,
    actor: "operator",
  });
  fs.writeFileSync(path.join(runRoot, "progress.md"), renderProgress(run));

  return { run, runRoot };
}

function inspectSupervisedRun(options = {}) {
  const found = findSupervisedRun(options);
  fs.writeFileSync(path.join(found.runRoot, "progress.md"), renderProgress(found.run));
  return {
    run: found.run,
    runRoot: found.runRoot,
    nextAction: getNextAction(found.run),
  };
}

function approveSupervisedRun(options = {}) {
  if (!options.yes) {
    throw new Error("Explicit approval requires --yes after reviewing the supervised plan preview.");
  }
  const found = findSupervisedRun(options);
  if (found.run.status !== "proposed" || found.run.tasks[0].status !== "proposed") {
    throw new Error(`Run ${found.runId} cannot be approved from status ${found.run.status}.`);
  }

  const approvedAt = new Date().toISOString();
  const run = {
    ...found.run,
    status: "approved",
    updatedAt: approvedAt,
    approval: {
      actor: "operator",
      approvedAt,
      planRevision: found.run.planRevision,
      execution: { ...found.run.execution },
      assurance: { ...found.run.assurance },
      budget: JSON.parse(JSON.stringify(found.run.budget)),
    },
    tasks: found.run.tasks.map((task, index) => (
      index === 0 ? { ...task, status: "ready" } : task
    )),
  };
  writeCanonicalRun(found.runRoot, run);
  appendEvent(found.runRoot, {
    schemaVersion: "supervised-event/v1-beta",
    timestamp: approvedAt,
    type: "run-approved",
    runId: found.runId,
    planRevision: run.planRevision,
    actor: "operator",
  });
  return {
    run,
    runRoot: found.runRoot,
    nextAction: getNextAction(run),
  };
}

module.exports = {
  SUPERVISED_RUN_SCHEMA_VERSION,
  appendEvent,
  createProposedRun,
  approveSupervisedRun,
  findSupervisedRun,
  getSupervisedRunsRoot,
  getNextAction,
  inspectSupervisedRun,
  renderProgress,
  writeCanonicalRun,
};
