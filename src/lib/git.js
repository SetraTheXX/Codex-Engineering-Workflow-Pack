"use strict";

const fs = require("node:fs");
const childProcess = require("node:child_process");

function runGit(args, cwd) {
  return childProcess.spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
}

function getGitOutput(args, cwd) {
  const result = runGit(args, cwd);

  if (result.error) {
    throw new Error(`Failed to run git ${args.join(" ")}: ${result.error.message}`);
  }

  return result;
}

function isRepoDirty(repoRoot) {
  const result = getGitOutput(["status", "--porcelain"], repoRoot);

  if (result.status !== 0) {
    throw new Error(`Failed to inspect git status: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result.stdout.trim().length > 0;
}

function branchExists(repoRoot, branch) {
  const result = getGitOutput(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
  return result.status === 0;
}

function getGitStatusShort(worktreePath) {
  const result = getGitOutput(["status", "--short"], worktreePath);

  if (result.status !== 0) {
    throw new Error(`Failed to inspect git status for ${worktreePath}: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function getGitHeadCommit(repoRoot) {
  const result = getGitOutput(["rev-parse", "HEAD"], repoRoot);

  if (result.status !== 0) {
    throw new Error(`Failed to read git HEAD for ${repoRoot}: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result.stdout.trim();
}

function getCommittedChangedFiles(worktreePath, baseCommit) {
  const result = getGitOutput(["diff", "--name-only", `${baseCommit}...HEAD`], worktreePath);

  if (result.status !== 0) {
    throw new Error(`Failed to inspect committed changes for ${worktreePath}: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function getGitBranchName(worktreePath) {
  const result = getGitOutput(["branch", "--show-current"], worktreePath);

  if (result.status !== 0) {
    return "unknown";
  }

  return result.stdout.trim() || "detached";
}

function isGitWorktreePath(worktreePath) {
  if (!fs.existsSync(worktreePath) || !fs.statSync(worktreePath).isDirectory()) {
    return false;
  }

  const result = getGitOutput(["rev-parse", "--is-inside-work-tree"], worktreePath);
  return result.status === 0 && result.stdout.trim() === "true";
}

function getGitDiffStat(worktreePath) {
  const result = getGitOutput(["diff", "--stat"], worktreePath);

  if (result.status !== 0) {
    return "(failed to read git diff --stat)";
  }

  return result.stdout.trim() || "(no diff stat)";
}

function removeGitWorktree(repoRoot, worktreePath) {
  const result = getGitOutput(["worktree", "remove", worktreePath], repoRoot);

  if (result.status !== 0) {
    throw new Error(`Failed to remove worktree ${worktreePath}: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function pruneGitWorktrees(repoRoot) {
  const result = getGitOutput(["worktree", "prune"], repoRoot);

  if (result.status !== 0) {
    throw new Error(`Failed to prune git worktrees: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

module.exports = {
  runGit,
  getGitOutput,
  isRepoDirty,
  branchExists,
  getGitStatusShort,
  getGitHeadCommit,
  getCommittedChangedFiles,
  getGitBranchName,
  isGitWorktreePath,
  getGitDiffStat,
  removeGitWorktree,
  pruneGitWorktrees,
};
