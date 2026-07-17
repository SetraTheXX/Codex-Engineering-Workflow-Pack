"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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
const SUPERVISED_PROPOSAL_SCHEMA_VERSION = "supervised-proposal/v1";
const SOURCE_KINDS = Object.freeze(["issue", "prd", "plan", "progress", "direct-goal"]);

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

function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readRepoFile(repoRoot, value, label) {
  const requested = requiredText(value, label);
  const resolved = path.resolve(repoRoot, requested);
  if (!isPathInside(repoRoot, resolved)) {
    throw new Error(`${label} must stay inside the repository: ${value}`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} file not found: ${value}`);
  }
  const realRepoRoot = fs.realpathSync(repoRoot);
  const realFile = fs.realpathSync(resolved);
  if (!isPathInside(realRepoRoot, realFile)) {
    throw new Error(`${label} must resolve inside the repository: ${value}`);
  }
  const content = fs.readFileSync(realFile);
  if (content.length > 1024 * 1024) {
    throw new Error(`${label} exceeds the 1 MiB Phase 9 intake limit.`);
  }
  return {
    absolutePath: realFile,
    relativePath: normalizeSlashPath(path.relative(realRepoRoot, realFile)),
    content,
    sha256: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
  };
}

function inferSourceKind(relativePath) {
  const name = path.basename(relativePath).toLowerCase();
  if (name === "progress.md") return "progress";
  if (name === "plan.md" || name.includes("roadmap")) return "plan";
  if (name.includes("prd") || name.includes("requirement")) return "prd";
  if (name.includes("issue")) return "issue";
  return "plan";
}

function validateSourceKind(value) {
  if (!SOURCE_KINDS.includes(value)) {
    throw new Error(`Unsupported source kind: ${value}. Expected ${SOURCE_KINDS.join(", ")}.`);
  }
  return value;
}

function makeSourceIdentity(repoRoot, sourcePath, sourceKind) {
  if (!sourcePath) {
    return { kind: "direct-goal", path: null, sha256: null };
  }
  const source = readRepoFile(repoRoot, sourcePath, "--from");
  return {
    kind: validateSourceKind(sourceKind || inferSourceKind(source.relativePath)),
    path: source.relativePath,
    sha256: source.sha256,
  };
}

function loadStructuredProposal(repoRoot, options) {
  const proposalFile = readRepoFile(repoRoot, options.proposalFile, "--proposal");
  let proposal;
  try {
    proposal = JSON.parse(proposalFile.content.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid supervised proposal JSON: ${proposalFile.relativePath}. ${error.message}`);
  }
  if (!proposal || proposal.schemaVersion !== SUPERVISED_PROPOSAL_SCHEMA_VERSION) {
    throw new Error(`Invalid supervised proposal schema. Expected ${SUPERVISED_PROPOSAL_SCHEMA_VERSION}.`);
  }
  if (proposal.checkpoints !== undefined || !proposal.checkpoint || typeof proposal.checkpoint !== "object") {
    throw new Error("Phase 9 supervised proposals require exactly one checkpoint; general workflow compilation begins in Phase 10.");
  }
  if (
    options.goal
    || options.scopes.length > 0
    || options.verificationCommands.length > 0
    || options.fullVerificationCommands.length > 0
    || options.stoppingConditions.length > 0
  ) {
    throw new Error("Use either --proposal or direct --goal/--scope/--verify/--stop fields, not both.");
  }
  const checkpoint = proposal.checkpoint;
  const assurance = proposal.assurance || {};
  const sourcePath = options.fromFile || (proposal.source && proposal.source.path);
  const sourceKind = options.sourceKind || (proposal.source && proposal.source.kind);
  return {
    goal: requiredText(proposal.goal, "proposal.goal"),
    title: requiredText(checkpoint.title || proposal.goal, "proposal.checkpoint.title"),
    scopes: requireList(checkpoint.allowedFiles, "proposal.checkpoint.allowedFiles").map(normalizeScope),
    forbiddenFiles: Array.isArray(checkpoint.forbiddenFiles)
      ? checkpoint.forbiddenFiles.map(normalizeScope)
      : [],
    verification: requireList(
      checkpoint.verification && checkpoint.verification.targeted,
      "proposal.checkpoint.verification.targeted",
    ),
    fullVerification: Array.isArray(checkpoint.verification && checkpoint.verification.full)
      ? checkpoint.verification.full.map((value) => requiredText(value, "proposal.checkpoint.verification.full"))
      : [],
    stoppingConditions: requireList(
      checkpoint.stoppingConditions,
      "proposal.checkpoint.stoppingConditions",
    ),
    assuranceProfile: options.assurance || assurance.profile || "standard",
    testAuthoring: options.testAuthoring || assurance.testAuthoring || "auto",
    source: makeSourceIdentity(repoRoot, sourcePath, sourceKind),
    proposal: {
      schemaVersion: SUPERVISED_PROPOSAL_SCHEMA_VERSION,
      path: proposalFile.relativePath,
      sha256: proposalFile.sha256,
    },
  };
}

function resolveIntake(repoRoot, options) {
  if (options.proposalFile) return loadStructuredProposal(repoRoot, options);
  const goal = requiredText(options.goal, "--goal");
  return {
    goal,
    title: goal,
    scopes: requireList(options.scopes, "--scope").map(normalizeScope),
    forbiddenFiles: [],
    verification: requireList(options.verificationCommands, "--verify"),
    fullVerification: Array.isArray(options.fullVerificationCommands)
      ? options.fullVerificationCommands.map((value) => requiredText(value, "--full-verify"))
      : [],
    stoppingConditions: requireList(options.stoppingConditions, "--stop"),
    assuranceProfile: options.assurance || "standard",
    testAuthoring: options.testAuthoring || "auto",
    source: makeSourceIdentity(repoRoot, options.fromFile, options.sourceKind),
    proposal: null,
  };
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
  if (run.status === "review-passed") {
    return {
      action: "receipt",
      command: `cewp supervise receipt ${run.runId}`,
      summary: "preview the supervised receipt",
    };
  }
  if (run.status === "ready-to-finalize") {
    return {
      action: "finalize",
      command: `cewp supervise finalize ${run.runId} --yes`,
      summary: "explicitly finalize the reviewed run",
    };
  }
  if (run.status === "completed") {
    return {
      action: "none",
      command: null,
      summary: "run completed",
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
  const intake = resolveIntake(repoRoot, options);
  const {
    assuranceProfile,
    fullVerification,
    goal,
    scopes,
    stoppingConditions,
    testAuthoring,
    verification,
  } = intake;
  validateProfile(assuranceProfile);
  validateTestAuthoring(testAuthoring);
  verification.forEach(validateVerificationCommand);
  fullVerification.forEach(validateVerificationCommand);
  const previewBudget = makeBudgetEnvelope(assuranceProfile);
  if (verification.length * 2 > previewBudget.maxTargetedVerificationRuns.value) {
    throw new Error("Approved targeted verification budget must cover both baseline and post-change checks.");
  }
  if (fullVerification.length > previewBudget.maxFullVerificationRuns.value) {
    throw new Error("Approved full verification commands exceed the assurance profile budget.");
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
    source: intake.source,
    proposal: intake.proposal,
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
        title: intake.title,
        status: "proposed",
        allowedFiles: scopes,
        forbiddenFiles: [...new Set([".git/**", ".cewp/**", ...intake.forbiddenFiles])],
        stoppingConditions,
        verification: {
          baseline: [],
          targeted: verification,
          full: fullVerification,
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
      independent: true,
      status: "pending",
      decision: null,
    },
    receipt: null,
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
