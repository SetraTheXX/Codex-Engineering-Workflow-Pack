"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { createFakeCodexAdapter } = require("../harness/lib/fake-adapter");
const { cleanupRepo, makeTempRepo, run, runNode } = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function parseJson(result, label) {
  assert(result.status === 0, `${label} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function supervise(repoRoot, args, label, env) {
  return parseJson(runNode(cewpCli, ["supervise", ...args, "--json"], repoRoot, { env }), label).data;
}

function sameFilesystemPath(left, right) {
  const normalize = (value) => {
    const resolved = path.normalize(fs.realpathSync.native(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function runLinearResumeContract() {
  const repoRoot = makeTempRepo("cewp-supervised-linear-resume-");
  const fake = createFakeCodexAdapter();
  try {
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture grants managed authority");

    const planned = supervise(repoRoot, [
      "plan",
      "--goal", "Complete two bounded README checkpoints",
      "--scope", "README.md",
      "--verify", "git diff --check",
      "--stop", "The first README checkpoint passes",
    ], "plan first checkpoint");
    const runId = planned.run.runId;
    supervise(repoRoot, ["approve", runId, "--yes"], "approve first checkpoint");
    const firstExecution = supervise(repoRoot, ["execute", runId, "--yes"], "execute first checkpoint", fake.env);
    const firstVerified = supervise(repoRoot, ["verify", runId], "verify first checkpoint");
    assert(firstVerified.run.status === "checkpoint-complete", "first checkpoint reaches the verified boundary");
    const preservedEvidence = JSON.parse(JSON.stringify(firstVerified.run.tasks[0].evidence));
    const managedWorktree = firstExecution.ownership.worktree.path;

    const paused = supervise(repoRoot, [
      "pause", runId, "--reason", "budget-safe", "--yes",
    ], "pause after first checkpoint");
    assert(paused.run.pause.previousRunStatus === "checkpoint-complete", "safe pause records the completed boundary");

    const revised = supervise(repoRoot, [
      "revise", runId,
      "--goal", "Apply the remaining bounded README checkpoint",
      "--scope", "README.md",
      "--verify", "git diff --check",
      "--stop", "The remaining README checkpoint passes",
    ], "revise remaining plan");
    assert(revised.run.status === "paused-budget-safe", "revision does not bypass the operator pause");
    assert(revised.run.pause.previousRunStatus === "proposed", "resume returns to fresh proposal approval");
    assert(revised.run.planRevision === 2, "remaining-plan revision increments the canonical plan");
    assert(revised.run.checkpointHistory.length === 1, "completed checkpoint moves to append-only history");
    assert(revised.run.checkpointHistory[0].id === "checkpoint-1", "history identifies the completed checkpoint");
    assert(revised.run.checkpointHistory[0].status === "completed", "archived checkpoint is explicitly complete");
    assert(revised.run.checkpointHistory[0].snapshot.commit, "completed checkpoint has an immutable Git snapshot");
    assert(JSON.stringify(revised.run.checkpointHistory[0].evidence) === JSON.stringify(preservedEvidence), "prior evidence is preserved byte-for-byte");
    assert(!Object.hasOwn(revised.run.checkpointHistory[0].ownership, "worktree"), "archived ownership does not copy a local worktree path into portable evidence");
    assert(revised.run.tasks[0].id === "checkpoint-2", "revision creates one new active checkpoint");
    assert(revised.run.tasks[0].baseCommit === revised.run.checkpointHistory[0].snapshot.commit, "next checkpoint starts from the verified snapshot");
    assert(run("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim() === planned.run.repo.baseCommit, "checkpoint snapshot never advances the source repository HEAD");

    const resumed = supervise(repoRoot, ["resume", runId, "--yes"], "resume revised plan");
    assert(resumed.run.status === "proposed", "resume reopens explicit approval for revised scope");
    supervise(repoRoot, ["approve", runId, "--yes"], "approve remaining checkpoint");
    const untouchedInstall = fs.readFileSync(path.join(managedWorktree, "docs", "install.md"), "utf8");
    fs.writeFileSync(path.join(managedWorktree, "docs", "install.md"), "# Out-of-band change\n");
    const tamperedContinuation = runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--json",
    ], repoRoot, { env: fake.env });
    assert(tamperedContinuation.status === 1 && tamperedContinuation.stderr.includes("unverified changes"), "out-of-band worktree changes close continuation dispatch");
    fs.writeFileSync(path.join(managedWorktree, "docs", "install.md"), untouchedInstall);
    const secondExecution = supervise(repoRoot, ["execute", runId, "--yes"], "execute remaining checkpoint", fake.env);
    assert(sameFilesystemPath(secondExecution.ownership.worktree.path, managedWorktree), "linear continuation reuses exactly one managed worktree");
    assert(secondExecution.ownership.checkpointId === "checkpoint-2", "ownership advances to the active checkpoint only");
    const secondVerified = supervise(repoRoot, ["verify", runId], "verify remaining checkpoint");
    assert(secondVerified.run.status === "checkpoint-complete", "remaining checkpoint reaches verification");
    assert(JSON.stringify(secondVerified.run.checkpointHistory[0].evidence) === JSON.stringify(preservedEvidence), "continued execution cannot rewrite prior evidence");

    const reviewed = supervise(repoRoot, ["review", runId, "--yes"], "review the complete linear run", fake.env);
    assert(reviewed.run.reviewer.decision === "PASS", "one independent reviewer covers the complete linear run");
    const reviewerPrompt = fs.readFileSync(path.join(repoRoot, ".cewp", "supervised-runs", runId, "review", "reviewer-prompt.md"), "utf8");
    assert(reviewerPrompt.includes("checkpoint-1") && reviewerPrompt.includes("checkpoint-2"), "reviewer prompt includes every checkpoint boundary");
    const preview = supervise(repoRoot, ["receipt", runId], "preview linear receipt");
    assert(preview.receipt.checkpoints.length === 2, "receipt includes completed and active checkpoint evidence");
    assert(preview.receipt.checkpoints[0].snapshot.commit === revised.run.checkpointHistory[0].snapshot.commit, "receipt retains the first snapshot identity");
    const finalized = supervise(repoRoot, ["finalize", runId, "--yes"], "finalize linear run");
    assert(finalized.run.status === "completed", "linear run finalizes only after reviewer PASS");

    const progress = fs.readFileSync(path.join(repoRoot, ".cewp", "supervised-runs", runId, "progress.md"), "utf8");
    assert(progress.includes("Completed checkpoints: 2"), "generated progress reports retained checkpoint history");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

try {
  runLinearResumeContract();
  console.log("[PASS] supervised linear pause, revise, and resume preserves prior evidence");
} catch (error) {
  console.error("[FAIL] supervised linear resume contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
