"use strict";

const fs = require("fs");
const path = require("path");
const {
  assert,
  assertExit,
  assertIncludes,
  assertFileExists,
  assertFileMissing,
} = require("./lib/assertions");
const {
  run,
  runNode,
  writeFile,
  readJson,
  writeJson,
  makeTempRepo,
  latestRunId,
  taskFixture,
  writeTask,
  readWorktrees,
  cleanupRepo,
} = require("./lib/temp-repo");

const cewpRoot = path.resolve(__dirname, "..", "..");
const cewpCli = path.join(cewpRoot, "bin", "cewp.js");
const packageJson = readJson(path.join(cewpRoot, "package.json"));
const results = [];
const tempRepos = [];

function pass(label) {
  results.push({ label, status: "PASS" });
  console.log(`[PASS] ${label}`);
}

function fail(label, error) {
  results.push({ label, status: "FAIL", error });
  console.log(`[FAIL] ${label}`);
  console.log(String(error && error.stack ? error.stack : error).slice(0, 4000));
}

async function step(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (error) {
    fail(label, error);
    throw error;
  }
}

function cewp(args, cwd) {
  return runNode(cewpCli, args, cwd);
}

function initHarnessRun(repoRoot, tasks) {
  const init = cewp(["run", "init", "--workers", "2", "--reviewer"], repoRoot);
  assertExit(init, 0, "run init");

  const runId = latestRunId(repoRoot);
  assert(runId, "run init did not create a run id");

  const repoName = path.basename(repoRoot);
  for (const task of tasks(runId, repoName)) {
    writeTask(repoRoot, runId, task);
  }

  return runId;
}

function createTwoTaskRun(repoRoot) {
  return initHarnessRun(repoRoot, (runId, repoName) => [
    taskFixture({
      id: "task-001",
      assignedRole: "worker-a",
      allowedFiles: ["README.md"],
      forbiddenFiles: ["package.json", ".env", ".agents/skills/**", "bin/cewp.js"],
      mission: "Update README.md only.",
      runId,
      repoName,
    }),
    taskFixture({
      id: "task-002",
      assignedRole: "worker-b",
      allowedFiles: ["docs/install.md"],
      forbiddenFiles: ["package.json", ".env", ".agents/skills/**", "bin/cewp.js"],
      mission: "Update docs/install.md only.",
      runId,
      repoName,
    }),
  ]);
}

function commitInWorktree(worktreePath, relativeFile, content, message) {
  writeFile(path.join(worktreePath, relativeFile), content);
  assertExit(run("git", ["add", relativeFile], { cwd: worktreePath }), 0, `git add ${relativeFile}`);
  assertExit(run("git", ["commit", "-m", message], { cwd: worktreePath }), 0, `git commit ${relativeFile}`);
}

function makeReport(repoRoot, runId, role, changedFile) {
  writeFile(
    path.join(repoRoot, ".cewp", "runs", runId, "reports", `${role}-report.md`),
    `# Worker Report\n\nRole: ${role}\nStatus: ready_for_review\n\n## Changed Files\n- ${changedFile}\n`,
  );
}

function pruneFixture(repoRoot) {
  const runsRoot = path.join(repoRoot, ".cewp", "runs");
  fs.mkdirSync(runsRoot, { recursive: true });

  for (const runId of ["20260529-000001", "20260529-000002", "20260529-000003"]) {
    fs.mkdirSync(path.join(runsRoot, runId), { recursive: true });
    writeFile(path.join(runsRoot, runId, "run.json"), "{}\n");
  }

  fs.mkdirSync(path.join(runsRoot, "not-a-run"), { recursive: true });
}

async function main() {
  console.log("CEWP Harness Smoke\n");

  let coordinatorRepo;
  let negativeRepo;
  let pruneRepo;
  let policyRepo;

  try {
    await step("cli help", () => {
      assertExit(cewp(["--help"], cewpRoot), 0, "cewp --help");
    });

    await step("doctor", () => {
      assertExit(cewp(["doctor"], cewpRoot), 0, "cewp doctor");
    });

    await step("list", () => {
      assertExit(cewp(["list"], cewpRoot), 0, "cewp list");
    });

    await step("operator policy", () => {
      policyRepo = makeTempRepo("cewp-harness-policy-");
      tempRepos.push(policyRepo);
      const showDefault = cewp(["policy", "show"], policyRepo);
      assertExit(showDefault, 0, "policy show default");
      assertIncludes(showDefault.stdout, "Mode: safe (default)", "default policy mode");

      const setFull = cewp(["policy", "set", "full-authority"], policyRepo);
      assertExit(setFull, 0, "policy set full-authority");
      const policyPath = path.join(policyRepo, ".cewp", "policy.json");
      assertFileExists(policyPath, "policy file");
      const policy = readJson(policyPath);
      assert(policy.mode === "full-authority", "expected full-authority policy");
      assert(policy.authority.runWorkers === true, "full-authority should allow workers");
      assert(policy.authority.push === false, "push should remain disabled by default");

      const reset = cewp(["policy", "reset"], policyRepo);
      assertExit(reset, 0, "policy reset");
      const resetPolicy = readJson(policyPath);
      assert(resetPolicy.mode === "safe", "policy reset should write safe mode");
    });

    coordinatorRepo = makeTempRepo("cewp-harness-flow-");
    tempRepos.push(coordinatorRepo);
    let flowRunId;
    let flowRegistry;

    await step("temp repo init", () => {
      flowRunId = createTwoTaskRun(coordinatorRepo);
      assertFileExists(path.join(coordinatorRepo, ".cewp", "runs", flowRunId, "run.json"), "run.json");
    });

    await step("worktrees create", () => {
      const create = cewp(["run", "worktrees", "create", "--run", flowRunId], coordinatorRepo);
      assertExit(create, 0, "worktrees create");
      flowRegistry = readWorktrees(coordinatorRepo, flowRunId);
      assert(flowRegistry.worktrees.length === 2, "expected two registered worktrees");
      for (const entry of flowRegistry.worktrees) {
        assert(entry.baseCommit, `${entry.taskId} missing baseCommit`);
        assert(fs.existsSync(entry.path), `${entry.taskId} worktree path missing`);
      }
    });

    await step("worktrees status", () => {
      const status = cewp(["run", "worktrees", "status", "--run", flowRunId], coordinatorRepo);
      assertExit(status, 0, "worktrees status");
      assertIncludes(status.stdout, "Scope: OK", "worktrees status");
    });

    await step("committed allowed changes visible", () => {
      const workerA = flowRegistry.worktrees.find((entry) => entry.assignedRole === "worker-a");
      const workerB = flowRegistry.worktrees.find((entry) => entry.assignedRole === "worker-b");
      commitInWorktree(workerA.path, "README.md", "# Harness Repo\n\nWorker A committed change.\n", "test: worker a docs");
      commitInWorktree(workerB.path, "docs/install.md", "# Install\n\nWorker B committed change.\n", "test: worker b docs");
      makeReport(coordinatorRepo, flowRunId, "worker-a", "README.md");
      makeReport(coordinatorRepo, flowRunId, "worker-b", "docs/install.md");

      const status = cewp(["run", "worktrees", "status", "--run", flowRunId], coordinatorRepo);
      assertExit(status, 0, "worktrees status after commits");
      assertIncludes(status.stdout, "Committed since baseCommit:", "committed changes header");
      assertIncludes(status.stdout, "README.md", "worker-a committed README");
      assertIncludes(status.stdout, "docs/install.md", "worker-b committed docs");
      assertIncludes(status.stdout, "Scope: OK", "committed allowed scope");

      const collect = cewp(["run", "collect", "--run", flowRunId], coordinatorRepo);
      assertExit(collect, 0, "collect");
      const packetPath = path.join(coordinatorRepo, ".cewp", "runs", flowRunId, "review-packets", "review-packet.md");
      assertFileExists(packetPath, "review packet");
      const packet = fs.readFileSync(packetPath, "utf8");
      assertIncludes(packet, "Committed branch changes", "review packet committed section");
      assertIncludes(packet, "README.md", "review packet README");
      assertIncludes(packet, "docs/install.md", "review packet docs");
    });

    negativeRepo = makeTempRepo("cewp-harness-negative-");
    tempRepos.push(negativeRepo);

    await step("committed outside allowed detected", () => {
      const runId = initHarnessRun(negativeRepo, (fixtureRunId, repoName) => [
        taskFixture({
          id: "task-001",
          assignedRole: "worker-a",
          allowedFiles: ["a.txt"],
          forbiddenFiles: ["package.json", ".env", ".agents/skills/**", "bin/cewp.js"],
          mission: "Only a.txt is allowed.",
          runId: fixtureRunId,
          repoName,
        }),
      ]);
      assertExit(cewp(["run", "worktrees", "create", "--run", runId], negativeRepo), 0, "negative worktree create");
      const registry = readWorktrees(negativeRepo, runId);
      const workerA = registry.worktrees.find((entry) => entry.assignedRole === "worker-a");
      commitInWorktree(workerA.path, "secret.txt", "committed secret\n", "test: forbidden outside scope");

      const status = cewp(["run", "worktrees", "status", "--run", runId], negativeRepo);
      assertExit(status, 0, "negative worktrees status");
      assertIncludes(status.stdout, "secret.txt", "outside allowed committed file");
      assertIncludes(status.stdout, "changed file outside allowedFiles: secret.txt", "outside allowed warning");
    });

    await step("run prune", () => {
      pruneRepo = makeTempRepo("cewp-harness-prune-");
      tempRepos.push(pruneRepo);
      pruneFixture(pruneRepo);

      const oldRun = path.join(pruneRepo, ".cewp", "runs", "20260529-000001");
      const newestA = path.join(pruneRepo, ".cewp", "runs", "20260529-000002");
      const newestB = path.join(pruneRepo, ".cewp", "runs", "20260529-000003");
      const notRun = path.join(pruneRepo, ".cewp", "runs", "not-a-run");

      const dryRun = cewp(["run", "prune", "--keep", "2"], pruneRepo);
      assertExit(dryRun, 0, "prune dry-run");
      assertIncludes(dryRun.stdout, "Would remove", "prune dry-run output");
      assertFileExists(oldRun, "old run after dry-run");

      const yes = cewp(["run", "prune", "--keep", "2", "--yes"], pruneRepo);
      assertExit(yes, 0, "prune --yes");
      assertFileMissing(oldRun, "old run after prune");
      assertFileExists(newestA, "newest run A after prune");
      assertFileExists(newestB, "newest run B after prune");
      assertFileExists(notRun, "non-run directory after prune");
    });

    await step("package surface", () => {
      const pack = run("npm", ["pack", "--dry-run"], { cwd: cewpRoot, timeout: 120000 });
      assertExit(pack, 0, "npm pack --dry-run");
      assert(packageJson.version === "0.2.0-beta.0", `unexpected package version: ${packageJson.version}`);
      assert(!pack.stdout.includes(".cewp/"), ".cewp/ should not be packed");
      assert(!pack.stdout.includes(".cewp-worktrees/"), ".cewp-worktrees/ should not be packed");
    });
  } finally {
    for (const repo of tempRepos.reverse()) {
      cleanupRepo(repo);
    }
  }

  const failed = results.filter((result) => result.status !== "PASS");
  console.log("");
  console.log(`Overall: ${failed.length === 0 ? "PASS" : "FAIL"}`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(() => {
  process.exitCode = 1;
});
