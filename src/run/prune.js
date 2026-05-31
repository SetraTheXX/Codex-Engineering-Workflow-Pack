"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getRunsRoot, validateRunId } = require("../lib/paths");
const { assertPolicyAllows } = require("./policy");

function getRunTimestampMs(runId) {
  validateRunId(runId);
  const year = Number.parseInt(runId.slice(0, 4), 10);
  const month = Number.parseInt(runId.slice(4, 6), 10) - 1;
  const day = Number.parseInt(runId.slice(6, 8), 10);
  const hour = Number.parseInt(runId.slice(9, 11), 10);
  const minute = Number.parseInt(runId.slice(11, 13), 10);
  const second = Number.parseInt(runId.slice(13, 15), 10);
  return new Date(year, month, day, hour, minute, second).getTime();
}

function listPrunableRuns(repoRoot = process.cwd()) {
  const runsRoot = getRunsRoot(repoRoot);

  if (!fs.existsSync(runsRoot)) {
    return {
      runsRoot,
      runs: [],
      ignored: [],
    };
  }

  const runs = [];
  const ignored = [];

  for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      ignored.push(entry.name);
      continue;
    }

    if (!/^\d{8}-\d{6}$/.test(entry.name)) {
      ignored.push(entry.name);
      continue;
    }

    const runRoot = path.join(runsRoot, entry.name);
    runs.push({
      runId: entry.name,
      runRoot,
      timestampMs: getRunTimestampMs(entry.name),
    });
  }

  runs.sort((left, right) => right.runId.localeCompare(left.runId));

  return {
    runsRoot,
    runs,
    ignored,
  };
}

function buildRunPrunePlan(options = {}, repoRoot = process.cwd(), now = new Date()) {
  const keep = options.keepRuns || (options.olderThanMs ? undefined : 10);
  const { runsRoot, runs, ignored } = listPrunableRuns(repoRoot);
  const latestRunId = runs.length > 0 ? runs[0].runId : undefined;
  const keepIds = new Set(keep ? runs.slice(0, keep).map((run) => run.runId) : []);
  const cutoffMs = options.olderThanMs ? now.getTime() - options.olderThanMs : undefined;
  const candidates = [];
  const kept = [];

  for (const run of runs) {
    const reasons = [];

    if (run.runId === latestRunId) {
      kept.push({ ...run, reason: "latest run" });
      continue;
    }

    if (keep && !keepIds.has(run.runId)) {
      reasons.push(`outside latest ${keep} runs`);
    }

    if (cutoffMs !== undefined && run.timestampMs < cutoffMs) {
      reasons.push(`older than ${options.olderThanRaw}`);
    }

    const selected = keep && cutoffMs !== undefined
      ? reasons.length === 2
      : reasons.length > 0;

    if (selected) {
      candidates.push({ ...run, reasons });
    } else {
      kept.push({
        ...run,
        reason: keepIds.has(run.runId)
          ? `within latest ${keep} runs`
          : cutoffMs !== undefined ? `not older than ${options.olderThanRaw}` : "kept",
      });
    }
  }

  return {
    runsRoot,
    runs,
    ignored,
    keep,
    olderThanRaw: options.olderThanRaw,
    cutoffMs,
    kept,
    candidates,
  };
}

function ensureRunRootUnderRunsRoot(runsRoot, runRoot) {
  const resolvedRunsRoot = path.resolve(runsRoot);
  const resolvedRunRoot = path.resolve(runRoot);
  const relative = path.relative(resolvedRunsRoot, resolvedRunRoot);

  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`Refusing to prune unsafe run path: ${runRoot}`);
  }
}

function printRunPrunePlan(plan, yes) {
  console.log("CEWP Coordinator Mode run prune");
  console.log("");
  console.log(`Runs root: ${plan.runsRoot}`);
  console.log(`Runs found: ${plan.runs.length}`);

  if (plan.keep) {
    console.log(`Keep: ${plan.keep} latest runs`);
  }

  if (plan.cutoffMs !== undefined) {
    console.log(`Older than: ${plan.olderThanRaw || "unknown"}`);
  }

  console.log(`Would remove: ${plan.candidates.length} runs`);
  console.log("");

  console.log("Kept:");
  if (plan.kept.length === 0) {
    console.log("  none");
  } else {
    for (const run of plan.kept) {
      console.log(`  ${run.runId} (${run.reason})`);
    }
  }
  console.log("");

  console.log(yes ? "Removed candidates:" : "Would remove:");
  if (plan.candidates.length === 0) {
    console.log("  none");
  } else {
    for (const run of plan.candidates) {
      console.log(`  ${run.runId} (${run.reasons.join("; ")})`);
    }
  }
  console.log("");

  if (plan.ignored.length > 0) {
    console.log("Ignored non-run entries:");
    for (const entry of plan.ignored) {
      console.log(`  ${entry}`);
    }
    console.log("");
  }

  if (!yes) {
    const keepArg = plan.keep ? ` --keep ${plan.keep}` : "";
    const olderArg = plan.olderThanRaw ? ` --older-than ${plan.olderThanRaw}` : "";
    console.log("Dry-run only. Re-run with:");
    console.log(`  cewp run prune${keepArg}${olderArg} --yes`);
  }
}

function runPrune(options = {}) {
  const repoRoot = process.cwd();

  if (options.yes) {
    assertPolicyAllows(repoRoot, "cleanup");
  }

  const plan = buildRunPrunePlan(options, repoRoot);

  printRunPrunePlan(plan, options.yes);

  if (!options.yes) {
    return;
  }

  for (const run of plan.candidates) {
    validateRunId(run.runId);
    ensureRunRootUnderRunsRoot(plan.runsRoot, run.runRoot);
    fs.rmSync(run.runRoot, { recursive: true, force: false });
  }

  console.log("");
  console.log("No worktrees, .cewp-worktrees, merge, push, or publish action was performed.");
}

module.exports = {
  runPrune,
};
