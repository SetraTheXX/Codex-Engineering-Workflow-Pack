"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("../lib/json");
const {
  getGitStatusShort,
  isGitWorktreePath,
  removeGitWorktree,
  pruneGitWorktrees,
} = require("../lib/git");
const { findRun, readWorktreesRegistry, appendRunEvent } = require("./runtime-cleanup");
const { assertPolicyAllows } = require("./policy");

function isPathUnderCewpWorktrees(worktreePath) {
  const normalized = path.resolve(worktreePath).replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/.cewp-worktrees/");
}

function getCleanupSnapshots(registry) {
  return registry.worktrees.map((entry) => {
    const exists = Boolean(entry.path && fs.existsSync(entry.path));
    const isDirectory = exists ? fs.statSync(entry.path).isDirectory() : false;
    const isGitWorktree = exists && isDirectory ? isGitWorktreePath(entry.path) : false;
    const safePath = Boolean(entry.path && isPathUnderCewpWorktrees(entry.path));
    const statusLines = exists && isGitWorktree ? getGitStatusShort(entry.path) : [];
    const dirty = statusLines.length > 0;
    let action = "would remove";
    let reason = "";

    if (!entry.path) {
      action = "skip";
      reason = "missing path";
    } else if (!safePath) {
      action = "warn";
      reason = "path outside .cewp-worktrees";
    } else if (!exists) {
      action = "skip";
      reason = "missing path";
    } else if (!isDirectory) {
      action = "warn";
      reason = "path is not a directory";
    } else if (!isGitWorktree) {
      action = "warn";
      reason = "path is not a git worktree";
    } else if (dirty) {
      action = "skip";
      reason = "dirty worktree";
    }

    return {
      entry,
      exists,
      isDirectory,
      isGitWorktree,
      safePath,
      statusLines,
      dirty,
      action,
      reason,
    };
  });
}

function printCleanupPlan({ runId, runRoot, snapshots, yes }) {
  console.log("CEWP Coordinator Mode cleanup");
  console.log(`Run ID: ${runId}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Mode: ${yes ? "cleanup" : "dry-run"}`);
  console.log("");
  console.log(`Worktrees: ${snapshots.length}`);
  console.log("");

  for (const snapshot of snapshots) {
    const entry = snapshot.entry;
    const status = snapshot.exists
      ? snapshot.isGitWorktree
        ? snapshot.dirty ? "dirty" : "clean"
        : snapshot.isDirectory ? "not a git worktree" : "not a directory"
      : "missing";
    const action = snapshot.action === "would remove" && yes
      ? "remove"
      : snapshot.action === "would remove"
        ? "would remove"
        : `${snapshot.action} ${snapshot.reason}`.trim();

    console.log(`${entry.taskId || "unknown-task"}`);
    console.log(`  Branch: ${entry.branch || "unknown"}`);
    console.log(`  Path: ${entry.path || "unknown"}`);
    console.log(`  Exists: ${snapshot.exists ? "yes" : "no"}`);
    console.log(`  Git worktree: ${snapshot.isGitWorktree ? "yes" : "no"}`);
    console.log(`  Status: ${status}`);
    console.log(`  Action: ${action}`);
    console.log("");
  }

  if (!yes) {
    console.log("Run with --yes to remove clean registered worktrees.");
  }
}

function runCleanup(options = {}) {
  const { runId, runRoot } = findRun(options);

  if (options.yes) {
    assertPolicyAllows(process.cwd(), "cleanup");
  }

  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const repoRoot = (runJson && runJson.repoRoot) || process.cwd();
  const registry = readWorktreesRegistry(runRoot);

  if (!registry) {
    console.log("No worktrees.json found. Nothing to clean up.");
    return;
  }

  const snapshots = getCleanupSnapshots(registry);
  const removable = snapshots.filter((snapshot) => (
    snapshot.safePath &&
    snapshot.exists &&
    snapshot.isGitWorktree &&
    !snapshot.dirty
  ));
  const skipped = snapshots.filter((snapshot) => !removable.includes(snapshot));

  printCleanupPlan({
    runId,
    runRoot,
    snapshots,
    yes: options.yes,
  });

  if (!options.yes) {
    appendRunEvent(runRoot, "cli", {
      event: "cleanup_dry_run",
      runId,
      removableCount: removable.length,
      skippedCount: skipped.length,
    });
    return;
  }

  const removed = [];
  const skippedMessages = [];

  for (const snapshot of snapshots) {
    if (removable.includes(snapshot)) {
      removeGitWorktree(repoRoot, snapshot.entry.path);
      removed.push(snapshot);
    } else {
      skippedMessages.push(`${snapshot.entry.taskId || "unknown-task"} -> ${snapshot.reason || "not removable"}`);
    }
  }

  pruneGitWorktrees(repoRoot);
  appendRunEvent(runRoot, "cli", {
    event: "cleanup_completed",
    runId,
    removedCount: removed.length,
    skippedCount: skippedMessages.length,
  });

  console.log("Removed:");
  if (removed.length === 0) {
    console.log("  none");
  } else {
    for (const snapshot of removed) {
      console.log(`  ${snapshot.entry.taskId || "unknown-task"} -> ${snapshot.entry.path}`);
    }
  }

  console.log("");
  console.log("Skipped:");
  if (skippedMessages.length === 0) {
    console.log("  none");
  } else {
    for (const message of skippedMessages) {
      console.log(`  ${message}`);
    }
  }

  console.log("");
  console.log("No merge, push, publish, or runtime history deletion was performed.");
}

module.exports = {
  runCleanup,
};
