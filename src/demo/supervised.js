"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..", "..");
const cewpCli = path.join(packageRoot, "bin", "cewp.js");
const fakeCodex = path.join(__dirname, "fake-codex.js");

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    timeout: options.timeout || 30000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stderr || ""}${result.stdout || ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error ? result.error.message : detail}`);
  }
  return result.stdout;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function runCewp(repoRoot, args, env = process.env) {
  return run(process.execPath, [cewpCli, ...args], { cwd: repoRoot, env, timeout: 60000 });
}

function runCewpJson(repoRoot, args, env) {
  const stdout = runCewp(repoRoot, [...args, "--json"], env);
  try {
    return JSON.parse(stdout).data;
  } catch (error) {
    throw new Error(`CEWP demo received invalid JSON for ${args.join(" ")}: ${error.message}`);
  }
}

function initializeRepo(repoRoot) {
  fs.mkdirSync(repoRoot, { recursive: true });
  writeFile(path.join(repoRoot, "README.md"), "# CEWP Demo Repository\n\nInitial state.\n");
  writeFile(path.join(repoRoot, "package.json"), "{\"private\":true}\n");
  writeFile(path.join(repoRoot, ".gitignore"), ".cewp/\n.cewp-worktrees/\n.cewp-worker-output/\n");
  run("git", ["init"], { cwd: repoRoot });
  run("git", ["config", "user.email", "cewp-demo@example.local"], { cwd: repoRoot });
  run("git", ["config", "user.name", "CEWP Demo"], { cwd: repoRoot });
  run("git", ["add", "."], { cwd: repoRoot });
  run("git", ["commit", "-m", "test: initialize deterministic demo"], { cwd: repoRoot });
}

function runSupervisedDemo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-supervised-demo-"));
  const repoRoot = path.join(tempRoot, "repo");
  const fakeEnv = {
    ...process.env,
    CEWP_CODEX_EXEC_COMMAND: process.execPath,
    CEWP_CODEX_EXEC_PREFIX_ARGS: JSON.stringify([fakeCodex]),
  };
  let report;
  let failure;

  try {
    initializeRepo(repoRoot);
    runCewp(repoRoot, ["policy", "set", "full-authority"]);
    const planned = runCewpJson(repoRoot, [
      "supervise", "plan",
      "--goal", "Update only the deterministic demo README",
      "--scope", "README.md",
      "--verify", "git diff --check",
      "--stop", "The README change passes the approved targeted verification",
    ]);
    const runId = planned.run.runId;
    runCewpJson(repoRoot, ["supervise", "approve", runId, "--yes"]);
    runCewpJson(repoRoot, ["supervise", "execute", runId, "--yes"], fakeEnv);
    const verified = runCewpJson(repoRoot, ["supervise", "verify", runId]);
    runCewpJson(repoRoot, ["supervise", "continue", runId]);
    const reviewed = runCewpJson(repoRoot, ["supervise", "review", runId, "--yes"], fakeEnv);
    const preview = runCewpJson(repoRoot, ["supervise", "receipt", runId]);
    const finalized = runCewpJson(repoRoot, ["supervise", "finalize", runId, "--yes"]);

    if (verified.run.status !== "checkpoint-complete" || reviewed.run.reviewer.decision !== "PASS") {
      throw new Error("Deterministic demo did not reach the verified reviewer PASS gate.");
    }
    report = {
      schemaVersion: "supervised-demo/v1-beta",
      status: "PASS",
      runStatus: finalized.run.status,
      reviewerDecision: finalized.run.reviewer.decision,
      execution: finalized.run.execution,
      credentialsUsed: false,
      realProviderStarted: false,
      modelOperations: {
        observed: finalized.run.usage.managedOperations.value,
        budgeted: finalized.run.budget.modelOperations.value,
      },
      localVerificationRuns: finalized.receipt.localVerificationActivity.runs,
      receiptSchemaVersion: preview.receipt.schemaVersion,
      cleanup: "pending",
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      if (report) report.cleanup = "complete";
    } catch (cleanupError) {
      failure = failure || cleanupError;
    }
  }

  if (failure) throw failure;
  return report;
}

function printHuman(report) {
  console.log("CEWP deterministic supervised demo");
  console.log(`Status: ${report.status}`);
  console.log(`Run: ${report.runStatus}`);
  console.log(`Reviewer: ${report.reviewerDecision}`);
  console.log(`Execution: ${report.execution.owner} / ${report.execution.backend}`);
  console.log(`Observed managed operations: ${report.modelOperations.observed}`);
  console.log(`Local verification runs: ${report.localVerificationRuns}`);
  console.log("Credentials: not used");
  console.log("Real providers: not started");
  console.log(`Cleanup: ${report.cleanup}`);
}

if (require.main === module) {
  try {
    const report = runSupervisedDemo();
    if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else printHuman(report);
  } catch (error) {
    console.error(`CEWP supervised demo failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  printHuman,
  runSupervisedDemo,
};
