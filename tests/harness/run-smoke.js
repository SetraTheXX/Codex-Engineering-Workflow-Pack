"use strict";

const fs = require("fs");
const path = require("path");
const {
  assert,
  assertExit,
  assertIncludes,
  assertNotIncludes,
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
const { createFakeCodexAdapter } = require("./lib/fake-adapter");
const { buildCodexExecInvocation, checkCodexExecAvailability, normalizeAdapterResult } = require("../../src/run/adapters/codex-exec");
const { normalizeAdapterConfig, resolveAdapterProviderForRole } = require("../../src/run/adapters/config");

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

function cewpWithEnv(args, cwd, env) {
  return runNode(cewpCli, args, cwd, { env });
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

function setupFakeAdapterRun(repoRoot) {
  const runId = createTwoTaskRun(repoRoot);
  assertExit(cewp(["run", "worktrees", "create", "--run", runId], repoRoot), 0, "fake adapter worktrees create");
  assertExit(cewp(["run", "dispatch", "prompts", "--run", runId], repoRoot), 0, "fake adapter dispatch prompts");
  assertExit(cewp(["policy", "set", "full-authority"], repoRoot), 0, "fake adapter policy full-authority");
  return {
    runId,
    registry: readWorktrees(repoRoot, runId),
  };
}

function assertFakeWorkerLifecycle(repoRoot, runId, registry, role, changedFile) {
  const worker = registry.worktrees.find((entry) => entry.assignedRole === role);
  assert(worker, `${role} registry entry missing`);

  assertFileExists(path.join(worker.path, ".cewp-worker-output", `${role}-report.md`), `${role} local report`);
  assertFileExists(path.join(worker.path, ".cewp-worker-output", `${role}-events.jsonl`), `${role} local events`);
  assertFileExists(path.join(repoRoot, ".cewp", "runs", runId, "reports", `${role}-report.md`), `${role} copied report`);
  assertFileExists(path.join(repoRoot, ".cewp", "runs", runId, "adapter-output", `${role}-last-message.md`), `${role} last message`);
  assertFileExists(path.join(repoRoot, ".cewp", "runs", runId, "adapter-output", `${role}-stdout.log`), `${role} stdout log`);
  assertFileExists(path.join(repoRoot, ".cewp", "runs", runId, "adapter-output", `${role}-stderr.log`), `${role} stderr log`);

  const status = cewp(["run", "worktrees", "status", "--run", runId], repoRoot);
  assertExit(status, 0, `${role} post fake worktrees status`);
  assertIncludes(status.stdout, changedFile, `${role} changed file visible`);
  assertIncludes(status.stdout, "Scope: OK", `${role} scope ok`);

  const report = fs.readFileSync(path.join(repoRoot, ".cewp", "runs", runId, "reports", `${role}-report.md`), "utf8");
  assertIncludes(report, "Fake codex lifecycle smoke.", `${role} copied report content`);
}

function assertFakeReviewerLifecycle(repoRoot, runId) {
  const runRoot = path.join(repoRoot, ".cewp", "runs", runId);
  const reportPath = path.join(runRoot, "reviews", "reviewer-report.md");
  const eventPath = path.join(runRoot, "events", "reviewer.jsonl");
  const lastMessagePath = path.join(runRoot, "adapter-output", "reviewer-last-message.md");
  const stdoutPath = path.join(runRoot, "adapter-output", "reviewer-stdout.log");
  const stderrPath = path.join(runRoot, "adapter-output", "reviewer-stderr.log");

  assertFileExists(reportPath, "reviewer report");
  assertFileExists(eventPath, "reviewer event log");
  assertFileExists(lastMessagePath, "reviewer last message");
  assertFileExists(stdoutPath, "reviewer stdout log");
  assertFileExists(stderrPath, "reviewer stderr log");

  const report = fs.readFileSync(reportPath, "utf8");
  assertIncludes(report, "Decision: PASS", "reviewer decision PASS");
  assertIncludes(report, "Fake reviewer lifecycle smoke.", "reviewer report content");
}

function assertRunIsNotCompleted(repoRoot, runId, label) {
  const runJson = readJson(path.join(repoRoot, ".cewp", "runs", runId, "run.json"));
  const boardJson = readJson(path.join(repoRoot, ".cewp", "runs", runId, "board.json"));
  assert(runJson.status !== "completed", `${label} run.json should not be completed`);
  assert(boardJson.status !== "completed", `${label} board.json should not be completed`);
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
      const result = cewp(["doctor"], cewpRoot);
      assertExit(result, 0, "cewp doctor");
      assertIncludes(result.stdout, "Adapter availability:", "doctor adapter availability section");
      assertIncludes(result.stdout, "codex-exec:", "doctor codex-exec availability");
    });

    await step("list", () => {
      assertExit(cewp(["list"], cewpRoot), 0, "cewp list");
    });

    await step("docs and dispatch wording", () => {
      const dispatchPlan = fs.readFileSync(path.join(cewpRoot, "src", "run", "dispatch", "plan.js"), "utf8");
      const dispatchStart = fs.readFileSync(path.join(cewpRoot, "src", "run", "dispatch", "start.js"), "utf8");

      assertNotIncludes(dispatchPlan, "codex-exec: planned, not implemented", "dispatch plan wording");
      assertNotIncludes(dispatchStart, "codex-exec: planned, not implemented", "dispatch start wording");
    });

    await step("operator policy", () => {
      policyRepo = makeTempRepo("cewp-harness-policy-");
      tempRepos.push(policyRepo);
      const showDefault = cewp(["policy", "show"], policyRepo);
      assertExit(showDefault, 0, "policy show default");
      assertIncludes(showDefault.stdout, "Mode: safe (default)", "default policy mode");

      const blockedWorkers = cewp(["run", "dispatch", "exec", "workers", "--adapter", "codex-exec", "--yes"], policyRepo);
      assertExit(blockedWorkers, 1, "safe policy blocks workers");
      assertIncludes(blockedWorkers.stderr, "operator policy blocks dispatch worker execution", "workers policy block");

      const blockedPipeline = cewp(["run", "dispatch", "pipeline", "--adapter", "codex-exec", "--yes"], policyRepo);
      assertExit(blockedPipeline, 1, "safe policy blocks pipeline");
      assertIncludes(blockedPipeline.stderr, "operator policy blocks dispatch pipeline execution", "pipeline policy block");

      pruneFixture(policyRepo);
      const pruneDryRun = cewp(["run", "prune", "--keep", "2"], policyRepo);
      assertExit(pruneDryRun, 0, "policy allows prune dry-run");
      const blockedPrune = cewp(["run", "prune", "--keep", "2", "--yes"], policyRepo);
      assertExit(blockedPrune, 1, "safe policy blocks prune deletion");
      assertIncludes(blockedPrune.stderr, "operator policy blocks cleanup/prune deletion", "prune policy block");

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

    await step("adapter registry validation", () => {
      const execUnsupported = cewp(["run", "dispatch", "exec", "worker-a", "--adapter", "not-real", "--dry-run"], cewpRoot);
      assertExit(execUnsupported, 1, "unsupported dispatch exec adapter");
      assertIncludes(execUnsupported.stderr, "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec.", "unsupported exec adapter message");

      const pipelineUnsupported = cewp(["run", "dispatch", "pipeline", "--adapter", "not-real", "--dry-run"], cewpRoot);
      assertExit(pipelineUnsupported, 1, "unsupported dispatch pipeline adapter");
      assertIncludes(pipelineUnsupported.stderr, "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec.", "unsupported pipeline adapter message");
    });

    await step("adapter result shape", () => {
      const result = normalizeAdapterResult({
        role: "worker-a",
        status: "FAIL",
        exitCode: 7,
        timedOut: false,
        reasons: ["codex exec exited with code 7."],
        paths: {
          stdout: "adapter-output/worker-a-stdout.log",
        },
      });

      assert(result.adapter === "codex-exec", "adapter result adapter name");
      assert(result.role === "worker-a", "adapter result role");
      assert(result.status === "FAIL", "adapter result status");
      assert(result.exitCode === 7, "adapter result exit code");
      assert(result.timedOut === false, "adapter result timeout");
      assert(result.reason === "codex exec exited with code 7.", "adapter result reason");
      assert(Array.isArray(result.reasons) && result.reasons.length === 1, "adapter result reasons");
      assert(result.paths.stdout === "adapter-output/worker-a-stdout.log", "adapter result paths");
    });

    await step("codex exec command construction", () => {
      const invocation = buildCodexExecInvocation({
        command: "node",
        prefixArgs: ["fake-codex.js"],
        worktreePath: "C:/repo/worktree",
        prompt: "Do the task",
        outputLastMessagePath: "C:/repo/run/adapter-output/worker-a-last-message.md",
        sandbox: "workspace-write",
      });

      assert(invocation.command === "node", "codex exec invocation command");
      assert(invocation.cwd === "C:/repo/worktree", "codex exec invocation cwd");
      assert(invocation.args[0] === "fake-codex.js", "codex exec invocation prefix");
      assert(invocation.args.includes("exec"), "codex exec invocation exec arg");
      assert(invocation.args.includes("--cd"), "codex exec invocation cd arg");
      assert(invocation.args.includes("--output-last-message"), "codex exec invocation output arg");
      assert(invocation.args[invocation.args.length - 1] === "Do the task", "codex exec invocation prompt last");
    });

    await step("codex exec availability", () => {
      const override = checkCodexExecAvailability({
        env: {
          CEWP_CODEX_EXEC_COMMAND: process.execPath,
          CEWP_CODEX_EXEC_PREFIX_ARGS: JSON.stringify(["fake-codex.js"]),
        },
      });
      assert(override.status === "PASS", "codex exec override available");
      assertIncludes(override.reason, "CEWP_CODEX_EXEC_COMMAND", "codex exec override reason");

      const missing = checkCodexExecAvailability({
        env: {
          PATH: "",
          Path: "",
        },
      });
      assert(missing.status === "FAIL", "codex exec missing binary fail");
      assertIncludes(missing.reason, "codex executable not found", "codex exec missing binary reason");
    });

    await step("adapter config normalization", () => {
      const defaults = normalizeAdapterConfig();
      for (const role of ["manager", "worker-a", "worker-b", "reviewer"]) {
        assert(defaults[role].provider === "codex-exec", `default adapter provider for ${role}`);
      }

      const explicit = normalizeAdapterConfig({
        roles: {
          "worker-a": { provider: "codex-exec" },
          reviewer: { provider: "codex-exec" },
        },
      });
      assert(explicit["worker-a"].provider === "codex-exec", "explicit worker-a provider");
      assert(explicit.reviewer.provider === "codex-exec", "explicit reviewer provider");
      assert(explicit["worker-b"].provider === "codex-exec", "default worker-b provider remains");
      assert(
        resolveAdapterProviderForRole({ role: "worker-a", adapterName: "codex-exec", commandName: "dispatch exec", requireAdapter: true }) === "codex-exec",
        "resolve worker-a adapter provider",
      );

      let unsupportedProviderError;
      try {
        normalizeAdapterConfig({ roles: { "worker-a": { provider: "not-real" } } });
      } catch (error) {
        unsupportedProviderError = error;
      }
      assert(
        unsupportedProviderError && unsupportedProviderError.message === "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec.",
        "unsupported adapter provider should fail",
      );

      let unknownRoleError;
      try {
        normalizeAdapterConfig({ roles: { intern: { provider: "codex-exec" } } });
      } catch (error) {
        unknownRoleError = error;
      }
      assert(
        unknownRoleError && unknownRoleError.message === "Unknown adapter config role: intern. Supported roles: manager, worker-a, worker-b, reviewer.",
        "unknown adapter role should fail",
      );
    });

    await step("dispatch adapter config resolution dry-run", () => {
      const configRepo = makeTempRepo("cewp-harness-adapter-config-");
      tempRepos.push(configRepo);
      const { runId } = setupFakeAdapterRun(configRepo);

      const workerDryRun = cewp(["run", "dispatch", "exec", "worker-a", "--run", runId, "--adapter", "codex-exec", "--dry-run"], configRepo);
      assertExit(workerDryRun, 0, "config worker-a dry-run");
      assertIncludes(workerDryRun.stdout, "Role: worker-a", "config worker dry-run role");
      assertIncludes(workerDryRun.stdout, "Adapter: codex-exec", "config worker dry-run adapter");

      makeReport(configRepo, runId, "worker-a", "README.md");
      makeReport(configRepo, runId, "worker-b", "docs/install.md");
      assertExit(cewp(["run", "collect", "--run", runId], configRepo), 0, "config collect");

      const reviewerDryRun = cewp(["run", "dispatch", "exec", "reviewer", "--run", runId, "--adapter", "codex-exec", "--dry-run"], configRepo);
      assertExit(reviewerDryRun, 0, "config reviewer dry-run");
      assertIncludes(reviewerDryRun.stdout, "Role: reviewer", "config reviewer dry-run role");
      assertIncludes(reviewerDryRun.stdout, "Adapter: codex-exec", "config reviewer dry-run adapter");
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

    await step("worker scope guardrails", () => {
      const scopeRepo = makeTempRepo("cewp-harness-scope-");
      tempRepos.push(scopeRepo);
      const runId = initHarnessRun(scopeRepo, (fixtureRunId, repoName) => [
        taskFixture({
          id: "task-001",
          assignedRole: "worker-a",
          allowedFiles: [],
          forbiddenFiles: ["package.json", ".env", ".agents/skills/**", "bin/cewp.js"],
          mission: "Empty allowedFiles should block real worker execution.",
          runId: fixtureRunId,
          repoName,
        }),
        taskFixture({
          id: "task-002",
          assignedRole: "worker-b",
          allowedFiles: ["docs/install.md"],
          forbiddenFiles: ["package.json", ".env", ".agents/skills/**", "bin/cewp.js"],
          mission: "Valid worker task.",
          runId: fixtureRunId,
          repoName,
        }),
      ]);

      assertExit(cewp(["run", "worktrees", "create", "--run", runId], scopeRepo), 0, "scope worktrees create");
      assertExit(cewp(["run", "dispatch", "prompts", "--run", runId], scopeRepo), 0, "scope dispatch prompts");
      assertExit(cewp(["policy", "set", "full-authority"], scopeRepo), 0, "scope policy full-authority");

      const dryRun = cewp(["run", "dispatch", "exec", "worker-a", "--run", runId, "--adapter", "codex-exec", "--dry-run"], scopeRepo);
      assertExit(dryRun, 0, "empty allowedFiles worker dry-run");
      assertIncludes(dryRun.stdout, "real worker execution requires an explicit file scope", "dry-run allowedFiles warning");

      const actual = cewp(["run", "dispatch", "exec", "worker-a", "--run", runId, "--adapter", "codex-exec", "--yes"], scopeRepo);
      assertExit(actual, 1, "empty allowedFiles worker actual");
      assertIncludes(actual.stdout, "task task-001 has no allowedFiles", "actual allowedFiles failure");

      const workers = cewp(["run", "dispatch", "exec", "workers", "--run", runId, "--adapter", "codex-exec", "--yes"], scopeRepo);
      assertExit(workers, 1, "empty allowedFiles workers actual");
      assertIncludes(workers.stdout, "worker-b: SKIPPED", "sequential worker-b skipped");

      const check = cewp(["run", "dispatch", "check", "--run", runId], scopeRepo);
      assertExit(check, 1, "dispatch check empty allowedFiles");
      assertIncludes(check.stdout, "allowedFiles is empty; real worker execution requires an explicit file scope", "dispatch check allowedFiles fail");
    });

    await step("fake codex worker lifecycle", () => {
      const fake = createFakeCodexAdapter();
      const fakeRepo = makeTempRepo("cewp-harness-fake-worker-");
      tempRepos.push(fakeRepo);

      try {
        const { runId, registry } = setupFakeAdapterRun(fakeRepo);
        const exec = cewpWithEnv([
          "run",
          "dispatch",
          "exec",
          "worker-a",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);

        assertExit(exec, 0, "fake worker-a dispatch exec");
        assertIncludes(exec.stdout, "Status: PASS", "fake worker-a pass");
        assertIncludes(exec.stdout, "Scope: OK", "fake worker-a scope");
        assertIncludes(exec.stdout, "Report: copied", "fake worker-a report copy");
        assertFakeWorkerLifecycle(fakeRepo, runId, registry, "worker-a", "README.md");
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("fake codex workers lifecycle", () => {
      const fake = createFakeCodexAdapter();
      const fakeRepo = makeTempRepo("cewp-harness-fake-workers-");
      tempRepos.push(fakeRepo);

      try {
        const { runId, registry } = setupFakeAdapterRun(fakeRepo);
        const exec = cewpWithEnv([
          "run",
          "dispatch",
          "exec",
          "workers",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);

        assertExit(exec, 0, "fake workers dispatch exec");
        assertIncludes(exec.stdout, "worker-a: PASS", "fake workers worker-a pass");
        assertIncludes(exec.stdout, "worker-b: PASS", "fake workers worker-b pass");
        assertIncludes(exec.stdout, "Overall: PASS", "fake workers overall pass");
        assertFakeWorkerLifecycle(fakeRepo, runId, registry, "worker-a", "README.md");
        assertFakeWorkerLifecycle(fakeRepo, runId, registry, "worker-b", "docs/install.md");

        const collect = cewp(["run", "collect", "--run", runId], fakeRepo);
        assertExit(collect, 0, "fake workers collect");
        const packetPath = path.join(fakeRepo, ".cewp", "runs", runId, "review-packets", "review-packet.md");
        assertFileExists(packetPath, "fake workers review packet");
        const packet = fs.readFileSync(packetPath, "utf8");
        assertIncludes(packet, "Fake codex lifecycle smoke.", "fake workers packet includes reports");
        assertIncludes(packet, "README.md", "fake workers packet README");
        assertIncludes(packet, "docs/install.md", "fake workers packet docs");
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("fake codex reviewer lifecycle", () => {
      const fake = createFakeCodexAdapter();
      const fakeRepo = makeTempRepo("cewp-harness-fake-reviewer-");
      tempRepos.push(fakeRepo);

      try {
        const { runId, registry } = setupFakeAdapterRun(fakeRepo);
        const workers = cewpWithEnv([
          "run",
          "dispatch",
          "exec",
          "workers",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);
        assertExit(workers, 0, "fake reviewer setup workers");

        const collect = cewp(["run", "collect", "--run", runId], fakeRepo);
        assertExit(collect, 0, "fake reviewer collect");

        const reviewer = cewpWithEnv([
          "run",
          "dispatch",
          "exec",
          "reviewer",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);
        assertExit(reviewer, 0, "fake reviewer dispatch exec");
        assertIncludes(reviewer.stdout, "Decision: PASS", "fake reviewer decision output");
        assertIncludes(reviewer.stdout, "Status: PASS", "fake reviewer status");
        assertFakeWorkerLifecycle(fakeRepo, runId, registry, "worker-a", "README.md");
        assertFakeWorkerLifecycle(fakeRepo, runId, registry, "worker-b", "docs/install.md");
        assertFakeReviewerLifecycle(fakeRepo, runId);

        const dryRunFinalize = cewp(["run", "finalize", "--run", runId, "--dry-run"], fakeRepo);
        assertExit(dryRunFinalize, 0, "fake reviewer finalize dry-run");
        assertIncludes(dryRunFinalize.stdout, "Reviewer decision: PASS", "finalize dry-run reviewer pass");
        assertIncludes(dryRunFinalize.stdout, "Dry run only. No files were changed.", "finalize dry-run no mutation");

        const finalize = cewp(["run", "finalize", "--run", runId], fakeRepo);
        assertExit(finalize, 0, "fake reviewer finalize");
        assertIncludes(finalize.stdout, "run.json: completed", "finalize run completed");
        const runJson = readJson(path.join(fakeRepo, ".cewp", "runs", runId, "run.json"));
        const boardJson = readJson(path.join(fakeRepo, ".cewp", "runs", runId, "board.json"));
        assert(runJson.status === "completed", "run.json should be completed");
        assert(boardJson.status === "completed", "board.json should be completed");
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("fake codex pipeline lifecycle", () => {
      const fake = createFakeCodexAdapter();
      const fakeRepo = makeTempRepo("cewp-harness-fake-pipeline-");
      tempRepos.push(fakeRepo);

      try {
        const { runId } = setupFakeAdapterRun(fakeRepo);
        const pipeline = cewpWithEnv([
          "run",
          "dispatch",
          "pipeline",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);

        assertExit(pipeline, 0, "fake pipeline dispatch");
        assertIncludes(pipeline.stdout, "Step 3/5 workers: PASS", "fake pipeline workers");
        assertIncludes(pipeline.stdout, "Step 4/5 collect: PASS", "fake pipeline collect");
        assertIncludes(pipeline.stdout, "Step 5/5 reviewer: PASS", "fake pipeline reviewer");
        assertIncludes(pipeline.stdout, "Reviewer decision: PASS", "fake pipeline decision");
        assertIncludes(pipeline.stdout, "Overall: PASS", "fake pipeline overall");
        assertFileExists(path.join(fakeRepo, ".cewp", "runs", runId, "review-packets", "review-packet.md"), "fake pipeline review packet");
        assertFakeReviewerLifecycle(fakeRepo, runId);
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("fake codex scope violation fails worker exec", () => {
      const fake = createFakeCodexAdapter("scope-violation");
      const fakeRepo = makeTempRepo("cewp-harness-fake-scope-violation-");
      tempRepos.push(fakeRepo);

      try {
        const { runId, registry } = setupFakeAdapterRun(fakeRepo);
        const exec = cewpWithEnv([
          "run",
          "dispatch",
          "exec",
          "worker-a",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);

        assertExit(exec, 1, "scope violation worker-a dispatch exec");
        assertIncludes(exec.stdout, "Execution: PASS", "scope violation adapter execution completed");
        assertIncludes(exec.stdout, "Status: FAIL", "scope violation status fail");
        assertIncludes(exec.stdout, "secret.txt", "scope violation changed file");
        assertIncludes(exec.stdout, "outside allowedFiles", "scope violation post-check");
        assertIncludes(exec.stdout, "Report: copied", "scope violation report copied");
        assertFileExists(path.join(fakeRepo, ".cewp", "runs", runId, "reports", "worker-a-report.md"), "scope violation copied report");
        assertFileExists(path.join(fakeRepo, ".cewp", "runs", runId, "adapter-output", "worker-a-last-message.md"), "scope violation last message");
        assertFileExists(path.join(fakeRepo, ".cewp", "runs", runId, "adapter-output", "worker-a-stdout.log"), "scope violation stdout log");
        assertFileExists(path.join(fakeRepo, ".cewp", "runs", runId, "adapter-output", "worker-a-stderr.log"), "scope violation stderr log");
        assertFileExists(path.join(registry.worktrees.find((entry) => entry.assignedRole === "worker-a").path, ".cewp-worker-output", "worker-a-report.md"), "scope violation local report");
        assertRunIsNotCompleted(fakeRepo, runId, "scope violation");
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("fake codex worker nonzero skips sequential worker-b", () => {
      const fake = createFakeCodexAdapter("worker-nonzero");
      const fakeRepo = makeTempRepo("cewp-harness-fake-worker-nonzero-");
      tempRepos.push(fakeRepo);

      try {
        const { runId } = setupFakeAdapterRun(fakeRepo);
        const exec = cewpWithEnv([
          "run",
          "dispatch",
          "exec",
          "workers",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);

        assertExit(exec, 1, "worker nonzero dispatch workers");
        assertIncludes(exec.stdout, "worker-a: FAIL", "worker nonzero worker-a fail");
        assertIncludes(exec.stdout, "worker-b: SKIPPED", "worker nonzero worker-b skipped");
        assertIncludes(exec.stdout, "Overall: FAIL", "worker nonzero overall fail");
        assertIncludes(exec.stdout, "codex exec exited with code 7.", "worker nonzero exit code");
        assertFileExists(path.join(fakeRepo, ".cewp", "runs", runId, "reports", "worker-a-report.md"), "worker nonzero copied report");
        assertFileExists(path.join(fakeRepo, ".cewp", "runs", runId, "adapter-output", "worker-a-stdout.log"), "worker nonzero stdout log");
        assertFileMissing(path.join(fakeRepo, ".cewp", "runs", runId, "reports", "worker-b-report.md"), "worker-b report should be skipped");
        assertRunIsNotCompleted(fakeRepo, runId, "worker nonzero");
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("fake codex pipeline reports worker failure reason", () => {
      const fake = createFakeCodexAdapter("scope-violation");
      const fakeRepo = makeTempRepo("cewp-harness-fake-pipeline-worker-failure-");
      tempRepos.push(fakeRepo);

      try {
        const { runId } = setupFakeAdapterRun(fakeRepo);
        const pipeline = cewpWithEnv([
          "run",
          "dispatch",
          "pipeline",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);

        assertExit(pipeline, 1, "pipeline worker failure");
        assertIncludes(pipeline.stdout, "Pipeline summary", "worker failure stable summary heading");
        assertIncludes(pipeline.stdout, "- check: PASS", "worker failure check pass");
        assertIncludes(pipeline.stdout, "- prompts: PASS", "worker failure prompts pass");
        assertIncludes(pipeline.stdout, "- workers: FAIL (worker-a: outside allowedFiles: secret.txt)", "worker failure reason");
        assertIncludes(pipeline.stdout, "- collect: SKIPPED", "worker failure collect skipped");
        assertIncludes(pipeline.stdout, "- reviewer: SKIPPED", "worker failure reviewer skipped");
        assertIncludes(pipeline.stdout, "- finalize: not run", "worker failure finalize not run");
        assertRunIsNotCompleted(fakeRepo, runId, "pipeline worker failure");
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("fake codex pipeline blocks missing reviewer decision", () => {
      const fake = createFakeCodexAdapter("reviewer-missing-decision");
      const fakeRepo = makeTempRepo("cewp-harness-fake-reviewer-missing-decision-");
      tempRepos.push(fakeRepo);

      try {
        const { runId } = setupFakeAdapterRun(fakeRepo);
        const pipeline = cewpWithEnv([
          "run",
          "dispatch",
          "pipeline",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);

        assertExit(pipeline, 1, "missing reviewer decision pipeline");
        assertIncludes(pipeline.stdout, "Step 3/5 workers: PASS", "missing decision pipeline workers");
        assertIncludes(pipeline.stdout, "Step 4/5 collect: PASS", "missing decision pipeline collect");
        assertIncludes(pipeline.stdout, "Step 5/5 reviewer: FAIL", "missing decision pipeline reviewer");
        assertIncludes(pipeline.stdout, "Overall: FAIL", "missing decision pipeline overall");
        assertNotIncludes(pipeline.stdout, "Reviewer decision: PASS", "missing decision should not print PASS");
        assertIncludes(pipeline.stdout, "Pipeline summary", "missing decision stable summary heading");
        assertIncludes(pipeline.stdout, "- workers: PASS", "missing decision workers pass");
        assertIncludes(pipeline.stdout, "- collect: PASS", "missing decision collect pass");
        assertIncludes(pipeline.stdout, "- reviewer: FAIL (reviewer decision not found)", "missing decision reason");
        assertIncludes(pipeline.stdout, "- finalize: not run", "missing decision finalize not run");

        const reportPath = path.join(fakeRepo, ".cewp", "runs", runId, "reviews", "reviewer-report.md");
        assertFileExists(reportPath, "missing decision reviewer report");
        const report = fs.readFileSync(reportPath, "utf8");
        assertNotIncludes(report, "Decision: PASS", "missing decision reviewer report no PASS");

        const dryRunFinalize = cewp(["run", "finalize", "--run", runId, "--dry-run"], fakeRepo);
        assertExit(dryRunFinalize, 1, "missing decision finalize dry-run");
        assertIncludes(dryRunFinalize.stderr, "Cannot finalize: reviewer decision not found.", "missing decision finalize gate");
        assertRunIsNotCompleted(fakeRepo, runId, "missing reviewer decision");
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("fake codex pipeline reports reviewer request changes", () => {
      const fake = createFakeCodexAdapter("reviewer-request-changes");
      const fakeRepo = makeTempRepo("cewp-harness-fake-reviewer-request-changes-");
      tempRepos.push(fakeRepo);

      try {
        const { runId } = setupFakeAdapterRun(fakeRepo);
        const pipeline = cewpWithEnv([
          "run",
          "dispatch",
          "pipeline",
          "--run",
          runId,
          "--adapter",
          "codex-exec",
          "--yes",
        ], fakeRepo, fake.env);

        assertExit(pipeline, 1, "request changes pipeline");
        assertIncludes(pipeline.stdout, "Reviewer decision: REQUEST_CHANGES", "request changes decision output");
        assertIncludes(pipeline.stdout, "- reviewer: FAIL (reviewer requested changes)", "request changes summary reason");
        assertIncludes(pipeline.stdout, "- finalize: not run", "request changes finalize not run");

        const dryRunFinalize = cewp(["run", "finalize", "--run", runId, "--dry-run"], fakeRepo);
        assertExit(dryRunFinalize, 1, "request changes pipeline finalize dry-run");
        assertIncludes(dryRunFinalize.stderr, "Cannot finalize: reviewer decision is REQUEST_CHANGES.", "request changes finalize gate");
        assertRunIsNotCompleted(fakeRepo, runId, "request changes pipeline");
      } finally {
        fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
      }
    });

    await step("finalize blocks request changes", () => {
      const reviewRepo = makeTempRepo("cewp-harness-review-gate-");
      tempRepos.push(reviewRepo);
      const runId = createTwoTaskRun(reviewRepo);
      const reviewPath = path.join(reviewRepo, ".cewp", "runs", runId, "reviews", "reviewer-report.md");
      writeFile(reviewPath, "# Reviewer Report\n\nDecision: REQUEST_CHANGES\n\n## Notes\nNeeds changes.\n");

      const dryRunFinalize = cewp(["run", "finalize", "--run", runId, "--dry-run"], reviewRepo);
      assertExit(dryRunFinalize, 1, "request changes finalize dry-run");
      assertIncludes(dryRunFinalize.stderr, "Cannot finalize: reviewer decision is REQUEST_CHANGES.", "request changes blocks finalize");
    });

    await step("parallel allowedFiles overlap", () => {
      const { getAllowedFilesOverlap } = require("../../src/lib/scope-check");
      assert(
        getAllowedFilesOverlap({ allowedFiles: ["docs/**"] }, { allowedFiles: ["docs/install.md"] }).length > 0,
        "docs/** should overlap docs/install.md",
      );
      assert(
        getAllowedFilesOverlap({ allowedFiles: ["docs/install.md"] }, { allowedFiles: ["docs/**"] }).length > 0,
        "docs/install.md should overlap docs/**",
      );
      assert(
        getAllowedFilesOverlap({ allowedFiles: ["docs/**"] }, { allowedFiles: ["docs/**"] }).length > 0,
        "same broad pattern should overlap",
      );
      assert(
        getAllowedFilesOverlap({ allowedFiles: ["README.md"] }, { allowedFiles: ["README.md"] }).length > 0,
        "same file should overlap",
      );
      assert(
        getAllowedFilesOverlap({ allowedFiles: ["README.md"] }, { allowedFiles: ["docs/install.md"] }).length === 0,
        "independent files should not overlap",
      );
    });

    await step("target worktree policy", () => {
      const traversalRepo = makeTempRepo("cewp-harness-traversal-");
      tempRepos.push(traversalRepo);
      const traversalRunId = initHarnessRun(traversalRepo, (fixtureRunId, repoName) => {
        const task = taskFixture({
          id: "task-001",
          assignedRole: "worker-a",
          allowedFiles: ["README.md"],
          forbiddenFiles: ["package.json", ".env", ".agents/skills/**", "bin/cewp.js"],
          mission: "Traversal target should be rejected.",
          runId: fixtureRunId,
          repoName,
        });
        task.targetWorktree = "../outside";
        return [task];
      });
      const traversalCreate = cewp(["run", "worktrees", "create", "--run", traversalRunId], traversalRepo);
      assertExit(traversalCreate, 1, "targetWorktree traversal rejected");
      assertIncludes(traversalCreate.stderr, "Unsafe targetWorktree", "traversal rejection");

      const absoluteRepo = makeTempRepo("cewp-harness-absolute-");
      tempRepos.push(absoluteRepo);
      const externalPath = path.join(path.dirname(absoluteRepo), `outside-worktree-${Date.now()}`);
      const absoluteRunId = initHarnessRun(absoluteRepo, (fixtureRunId, repoName) => {
        const task = taskFixture({
          id: "task-001",
          assignedRole: "worker-a",
          allowedFiles: ["README.md"],
          forbiddenFiles: ["package.json", ".env", ".agents/skills/**", "bin/cewp.js"],
          mission: "Absolute external target should be rejected.",
          runId: fixtureRunId,
          repoName,
        });
        task.targetWorktree = externalPath;
        return [task];
      });
      const absoluteCreate = cewp(["run", "worktrees", "create", "--run", absoluteRunId], absoluteRepo);
      assertExit(absoluteCreate, 1, "absolute external targetWorktree rejected");
      assertIncludes(absoluteCreate.stderr, "External targetWorktree", "absolute external rejection");
      assertFileMissing(externalPath, "absolute external worktree");

      const managedRepo = makeTempRepo("cewp-harness-managed-absolute-");
      tempRepos.push(managedRepo);
      const managedRunId = initHarnessRun(managedRepo, (fixtureRunId, repoName) => {
        const task = taskFixture({
          id: "task-001",
          assignedRole: "worker-a",
          allowedFiles: ["README.md"],
          forbiddenFiles: ["package.json", ".env", ".agents/skills/**", "bin/cewp.js"],
          mission: "Managed absolute target should be accepted.",
          runId: fixtureRunId,
          repoName,
        });
        task.targetWorktree = path.resolve(managedRepo, "..", ".cewp-worktrees", repoName, fixtureRunId, "task-001");
        return [task];
      });
      const managedCreate = cewp(["run", "worktrees", "create", "--run", managedRunId], managedRepo);
      assertExit(managedCreate, 0, "managed absolute targetWorktree accepted");

      const registry = readWorktrees(managedRepo, managedRunId);
      const externalRegistryPath = path.join(path.dirname(managedRepo), `external-registry-${Date.now()}`);
      fs.mkdirSync(externalRegistryPath, { recursive: true });
      registry.worktrees[0].path = externalRegistryPath;
      writeJson(path.join(managedRepo, ".cewp", "runs", managedRunId, "worktrees.json"), registry);

      const check = cewp(["run", "dispatch", "check", "--run", managedRunId], managedRepo);
      assertExit(check, 1, "dispatch check external registry path");
      assertIncludes(check.stdout, "worktree path is outside CEWP-managed root", "external registry path warning");

      assertExit(cewp(["policy", "set", "full-authority"], managedRepo), 0, "managed repo full-authority");
      const cleanup = cewp(["run", "cleanup", "--run", managedRunId, "--yes"], managedRepo);
      assertExit(cleanup, 0, "cleanup external registry path");
      assertFileExists(externalRegistryPath, "cleanup must not remove external registry path");
      fs.rmSync(externalRegistryPath, { recursive: true, force: true });
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

      assertExit(cewp(["policy", "set", "full-authority"], pruneRepo), 0, "policy set full-authority for prune");
      const yes = cewp(["run", "prune", "--keep", "2", "--yes"], pruneRepo);
      assertExit(yes, 0, "prune --yes");
      assertFileMissing(oldRun, "old run after prune");
      assertFileExists(newestA, "newest run A after prune");
      assertFileExists(newestB, "newest run B after prune");
      assertFileExists(notRun, "non-run directory after prune");
    });

    await step("package surface", () => {
      const pack = run("npm", ["pack", "--dry-run"], { cwd: cewpRoot, timeout: 120000 });
      const packOutput = `${pack.stdout}\n${pack.stderr}`;
      assertExit(pack, 0, "npm pack --dry-run");
      assert(packageJson.version === "0.3.0-beta.0", `unexpected package version: ${packageJson.version}`);
      assert(packOutput.includes("docs/adapter-contract.md"), "adapter contract doc should be packed");
      assert(!packOutput.includes(".cewp/"), ".cewp/ should not be packed");
      assert(!packOutput.includes(".cewp-worktrees/"), ".cewp-worktrees/ should not be packed");
      assert(!packOutput.includes(".ctxo/"), ".ctxo/ should not be packed");
      assert(!packOutput.includes("docs/agents/"), "docs/agents/ should not be packed");
      assert(!packOutput.includes("tests/"), "tests/ should not be packed");
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
