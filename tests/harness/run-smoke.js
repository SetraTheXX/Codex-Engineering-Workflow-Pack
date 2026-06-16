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
const { normalizeAdapterResult: normalizeManualAdapterResult } = require("../../src/run/adapters/manual");
const { getAdapterCapabilities, getSupportedAdapterNames } = require("../../src/run/adapters/registry");
const { loadAdapterConfig, normalizeAdapterConfig, resolveAdapterProviderForRole } = require("../../src/run/adapters/config");

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

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not produce valid JSON: ${error.message}\n${result.stdout}`);
  }
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

function snapshotRunFiles(runRoot) {
  const snapshot = new Map();

  function visit(directory) {
    if (!fs.existsSync(directory)) {
      return;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      const stat = fs.statSync(entryPath);
      snapshot.set(path.relative(runRoot, entryPath), `${stat.size}:${stat.mtimeMs}`);
    }
  }

  visit(runRoot);
  return snapshot;
}

function assertSnapshotsEqual(before, after, label) {
  assert(before.size === after.size, `${label} file count changed`);

  for (const [filePath, value] of before.entries()) {
    assert(after.get(filePath) === value, `${label} changed ${filePath}`);
  }
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
      const help = cewp(["--help"], cewpRoot);
      assertExit(help, 0, "cewp --help");
      assertIncludes(help.stdout, "cewp run list [--limit <count>]", "help includes operator run list");
      assertIncludes(help.stdout, "cewp run list --json", "help includes operator run list json");
      assertIncludes(help.stdout, "cewp run status [run-id]", "help includes operator run status");
      assertIncludes(help.stdout, "cewp run status 20260528-232250 --json", "help includes operator run status json");
      assertIncludes(help.stdout, "cewp run next [run-id]", "help includes operator run next");
      assertIncludes(help.stdout, "cewp run next 20260528-232250 --json", "help includes operator run next json");
      assertIncludes(help.stdout, "cewp run resume [run-id]", "help includes operator run resume");
      assertIncludes(help.stdout, "cewp run resume 20260528-232250 --json", "help includes operator run resume json");
    });

    await step("doctor", () => {
      const result = cewp(["doctor"], cewpRoot);
      assertExit(result, 0, "cewp doctor");
      assertIncludes(result.stdout, "Adapter availability:", "doctor adapter availability section");
      assertIncludes(result.stdout, "codex-exec:", "doctor codex-exec availability");
      assertIncludes(result.stdout, "Adapter capabilities:", "doctor adapter capabilities section");
      assertIncludes(result.stdout, "codex-exec: executing, dry-run, external command", "doctor codex-exec capabilities");
      assertIncludes(result.stdout, "manual: non-executing, dry-run, handoff, result-intake, no external command", "doctor manual capabilities");
      assertIncludes(result.stdout, "Adapter config:", "doctor adapter config section");
      assertIncludes(result.stdout, "Source: default", "doctor adapter config default source");
      assertIncludes(result.stdout, "manager: codex-exec", "doctor adapter config manager provider");
      assertIncludes(result.stdout, "worker-a: codex-exec", "doctor adapter config worker-a provider");
      assertIncludes(result.stdout, "worker-b: codex-exec", "doctor adapter config worker-b provider");
      assertIncludes(result.stdout, "reviewer: codex-exec", "doctor adapter config reviewer provider");
    });

    await step("doctor adapter config file summary", () => {
      const doctorConfigRepo = makeTempRepo("cewp-harness-doctor-config-");
      tempRepos.push(doctorConfigRepo);
      assertExit(cewp(["init"], doctorConfigRepo), 0, "doctor config repo init");
      writeJson(path.join(doctorConfigRepo, "cewp.config.json"), {
        adapters: {
          manager: { provider: "codex-exec" },
          "worker-a": { provider: "manual" },
          "worker-b": { provider: "codex-exec" },
          reviewer: { provider: "codex-exec" },
        },
      });

      const validDoctor = cewp(["doctor"], doctorConfigRepo);
      assertExit(validDoctor, 0, "doctor valid adapter config");
      assertIncludes(validDoctor.stdout, "Adapter config:", "doctor valid config section");
      assertIncludes(validDoctor.stdout, "Source: cewp.config.json", "doctor config file source");
      assertIncludes(validDoctor.stdout, "manual: manual adapter writes handoff prompts", "doctor manual availability");
      assertIncludes(validDoctor.stdout, "worker-a: manual", "doctor valid config worker-a manual");

      const unsupportedRepo = makeTempRepo("cewp-harness-doctor-unsupported-");
      tempRepos.push(unsupportedRepo);
      assertExit(cewp(["init"], unsupportedRepo), 0, "doctor unsupported repo init");
      writeJson(path.join(unsupportedRepo, "cewp.config.json"), {
        adapters: {
          "worker-a": { provider: "not-real" },
        },
      });
      const unsupportedDoctor = cewp(["doctor"], unsupportedRepo);
      assertExit(unsupportedDoctor, 1, "doctor unsupported adapter config");
      assertIncludes(unsupportedDoctor.stderr, "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec, manual.", "doctor unsupported config message");

      const invalidJsonRepo = makeTempRepo("cewp-harness-doctor-invalid-json-");
      tempRepos.push(invalidJsonRepo);
      assertExit(cewp(["init"], invalidJsonRepo), 0, "doctor invalid json repo init");
      writeFile(path.join(invalidJsonRepo, "cewp.config.json"), "{ invalid json\n");
      const invalidJsonDoctor = cewp(["doctor"], invalidJsonRepo);
      assertExit(invalidJsonDoctor, 1, "doctor invalid adapter config json");
      assertIncludes(invalidJsonDoctor.stderr, "Invalid cewp.config.json JSON:", "doctor invalid config json message");
      assertIncludes(invalidJsonDoctor.stderr, "cewp.config.json", "doctor invalid config json path");
    });

    await step("init adapter config template", () => {
      const defaultInitRepo = makeTempRepo("cewp-harness-init-default-");
      tempRepos.push(defaultInitRepo);
      assertExit(cewp(["init"], defaultInitRepo), 0, "default init");
      assertFileMissing(path.join(defaultInitRepo, "cewp.config.json"), "default init adapter config");

      const configInitRepo = makeTempRepo("cewp-harness-init-config-");
      tempRepos.push(configInitRepo);
      const configInit = cewp(["init", "--with-config"], configInitRepo);
      assertExit(configInit, 0, "init with config");
      assertIncludes(configInit.stdout, "Created adapter config: cewp.config.json", "init with config message");
      const generatedConfig = readJson(path.join(configInitRepo, "cewp.config.json"));
      for (const role of ["manager", "worker-a", "worker-b", "reviewer"]) {
        assert(generatedConfig.adapters[role].provider === "codex-exec", `generated adapter config ${role}`);
      }

      const existingConfigRepo = makeTempRepo("cewp-harness-init-existing-config-");
      tempRepos.push(existingConfigRepo);
      writeJson(path.join(existingConfigRepo, "cewp.config.json"), {
        adapters: {
          "worker-a": { provider: "codex-exec" },
        },
      });
      const existingConfigInit = cewp(["init", "--with-config"], existingConfigRepo);
      assertExit(existingConfigInit, 0, "init with existing config");
      assertIncludes(existingConfigInit.stdout, "Adapter config already exists: cewp.config.json", "existing config not overwritten message");
      const preservedConfig = readJson(path.join(existingConfigRepo, "cewp.config.json"));
      assert(preservedConfig.adapters.manager === undefined, "existing adapter config should not be overwritten");
      assert(preservedConfig.adapters["worker-a"].provider === "codex-exec", "existing adapter config worker-a preserved");
    });

    await step("list", () => {
      assertExit(cewp(["list"], cewpRoot), 0, "cewp list");
    });

    await step("operator run list", () => {
      const emptyRunsRepo = makeTempRepo("cewp-harness-run-list-empty-");
      tempRepos.push(emptyRunsRepo);
      const emptyList = cewp(["run", "list"], emptyRunsRepo);
      assertExit(emptyList, 0, "run list no runs");
      assertIncludes(emptyList.stdout, "CEWP Coordinator Mode run list", "run list heading no runs");
      assertIncludes(emptyList.stdout, "No CEWP runs found.", "run list no runs message");
      const emptyListJson = cewp(["run", "list", "--json"], emptyRunsRepo);
      assertExit(emptyListJson, 0, "run list no runs json");
      const emptyListValue = parseJsonOutput(emptyListJson, "run list no runs json");
      assert(emptyListValue.command === "run list", "run list no runs json command");
      assert(Array.isArray(emptyListValue.runs) && emptyListValue.runs.length === 0, "run list no runs json runs");
      assert(emptyListValue.latestRunId === null, "run list no runs json latest");

      const listRepo = makeTempRepo("cewp-harness-run-list-");
      tempRepos.push(listRepo);
      const runsRoot = path.join(listRepo, ".cewp", "runs");
      const oldRunId = "20260529-000001";
      const latestRunIdForList = "20260529-000002";
      const oldRunRoot = path.join(runsRoot, oldRunId);
      const latestRunRoot = path.join(runsRoot, latestRunIdForList);

      for (const runRoot of [oldRunRoot, latestRunRoot]) {
        fs.mkdirSync(path.join(runRoot, "tasks"), { recursive: true });
        fs.mkdirSync(path.join(runRoot, "manual"), { recursive: true });
        fs.mkdirSync(path.join(runRoot, "reports"), { recursive: true });
        fs.mkdirSync(path.join(runRoot, "reviews"), { recursive: true });
        fs.mkdirSync(path.join(runRoot, "review-packets"), { recursive: true });
        fs.mkdirSync(path.join(runRoot, "events"), { recursive: true });
      }

      writeJson(path.join(oldRunRoot, "run.json"), {
        runId: oldRunId,
        createdAt: "2026-05-29T00:00:01.000Z",
        status: "dispatching",
      });
      writeJson(path.join(oldRunRoot, "board.json"), {
        runId: oldRunId,
        status: "dispatching",
        roles: {
          "worker-a": { status: "active" },
          reviewer: { status: "waiting" },
        },
      });
      writeJson(path.join(oldRunRoot, "tasks", "task-001.json"), {
        id: "task-001",
        status: "doing",
        assignedRole: "worker-a",
      });
      writeFile(path.join(oldRunRoot, "manual", "worker-a.md"), "# Manual Handoff\n");

      writeJson(path.join(latestRunRoot, "run.json"), {
        runId: latestRunIdForList,
        createdAt: "2026-05-29T00:00:02.000Z",
        status: "reviewing",
      });
      writeJson(path.join(latestRunRoot, "board.json"), {
        runId: latestRunIdForList,
        status: "reviewing",
        roles: {
          "worker-a": { status: "done" },
          "worker-b": { status: "done" },
          reviewer: { status: "done" },
        },
      });
      writeJson(path.join(latestRunRoot, "tasks", "task-001.json"), {
        id: "task-001",
        status: "done",
        assignedRole: "worker-a",
      });
      writeFile(path.join(latestRunRoot, "reports", "worker-a-report.md"), "# Worker Report\n");
      writeFile(path.join(latestRunRoot, "review-packets", "review-packet.md"), "# Review Packet\n");
      writeFile(path.join(latestRunRoot, "reviews", "reviewer-report.md"), "# Reviewer Report\n\nDecision: PASS\n");

      const beforeList = snapshotRunFiles(runsRoot);
      const list = cewp(["run", "list"], listRepo);
      const afterList = snapshotRunFiles(runsRoot);
      assertExit(list, 0, "run list multiple runs");
      assertSnapshotsEqual(beforeList, afterList, "run list should be read-only");
      assertIncludes(list.stdout, oldRunId, "run list old run");
      assertIncludes(list.stdout, `${latestRunIdForList} (latest)`, "run list latest marker");
      assertIncludes(list.stdout, "created: 2026-05-29T00:00:02.000Z", "run list created time");
      assertIncludes(list.stdout, "manual handoff: yes", "run list manual handoff presence");
      assertIncludes(list.stdout, "worker reports: yes (1)", "run list worker report presence");
      assertIncludes(list.stdout, "review packet: yes", "run list review packet presence");
      assertIncludes(list.stdout, "reviewer report: yes", "run list reviewer report presence");
      assertIncludes(list.stdout, "reviewer PASS: yes", "run list reviewer pass presence");
      assertIncludes(list.stdout, "next: complete-manual", "run list manual next label");
      assertIncludes(list.stdout, "next: finalize-dry-run", "run list finalize next label");

      const listJson = cewp(["run", "list", "--json"], listRepo);
      assertExit(listJson, 0, "run list json");
      const listValue = parseJsonOutput(listJson, "run list json");
      assert(listValue.command === "run list", "run list json command");
      assert(listValue.latestRunId === latestRunIdForList, "run list json latest run id");
      assert(Array.isArray(listValue.runs) && listValue.runs.length === 2, "run list json runs count");
      const latestJsonRun = listValue.runs[0];
      const oldJsonRun = listValue.runs[1];
      assert(latestJsonRun.runId === latestRunIdForList, "run list json latest first");
      assert(latestJsonRun.latest === true, "run list json latest marker");
      assert(latestJsonRun.artifacts.reports.present === true, "run list json report present");
      assert(latestJsonRun.artifacts.reviewPackets.present === true, "run list json review packet present");
      assert(latestJsonRun.artifacts.reviews.present === true, "run list json review present");
      assert(latestJsonRun.reviewer.pass === true, "run list json reviewer pass");
      assert(latestJsonRun.nextAction.label === "finalize-dry-run", "run list json next label");
      assert(oldJsonRun.artifacts.manualHandoffs.present === true, "run list json manual handoff present");
      assert(oldJsonRun.nextAction.label === "complete-manual", "run list json manual next label");

      const limited = cewp(["run", "list", "--limit", "1"], listRepo);
      assertExit(limited, 0, "run list limit");
      assertIncludes(limited.stdout, `${latestRunIdForList} (latest)`, "run list limit latest");
      assertNotIncludes(limited.stdout, oldRunId, "run list limit hides older run");

      const limitedJson = cewp(["run", "list", "--limit", "1", "--json"], listRepo);
      assertExit(limitedJson, 0, "run list limit json");
      const limitedJsonValue = parseJsonOutput(limitedJson, "run list limit json");
      assert(limitedJsonValue.limit === 1, "run list limit json limit");
      assert(limitedJsonValue.runs.length === 1, "run list limit json run count");
      assert(limitedJsonValue.runs[0].runId === latestRunIdForList, "run list limit json latest");
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
      const supported = getSupportedAdapterNames();
      assert(supported.includes("codex-exec"), "registry supports codex-exec");
      assert(supported.includes("manual"), "registry supports manual");

      const codexExecCapabilities = getAdapterCapabilities("codex-exec");
      assert(codexExecCapabilities.provider === "codex-exec", "codex-exec capability provider");
      assert(codexExecCapabilities.kind === "executing", "codex-exec capability kind");
      assert(codexExecCapabilities.executesExternalCommand === true, "codex-exec executes external command");
      assert(codexExecCapabilities.supportsDryRun === true, "codex-exec supports dry-run");
      assert(codexExecCapabilities.supportsManualHandoff === false, "codex-exec manual handoff capability");
      assert(codexExecCapabilities.supportsResultIntake === false, "codex-exec result intake capability");
      assert(codexExecCapabilities.requiresExternalBinary === true, "codex-exec external binary capability");
      assert(codexExecCapabilities.requiresAuth === false, "codex-exec auth capability");
      assert(codexExecCapabilities.supportsLastMessage === true, "codex-exec last-message capability");

      const manualCapabilities = getAdapterCapabilities("manual");
      assert(manualCapabilities.provider === "manual", "manual capability provider");
      assert(manualCapabilities.kind === "non-executing", "manual capability kind");
      assert(manualCapabilities.executesExternalCommand === false, "manual external command capability");
      assert(manualCapabilities.supportsDryRun === true, "manual supports dry-run");
      assert(manualCapabilities.supportsManualHandoff === true, "manual handoff capability");
      assert(manualCapabilities.supportsResultIntake === true, "manual result intake capability");
      assert(manualCapabilities.requiresExternalBinary === false, "manual external binary capability");
      assert(manualCapabilities.requiresAuth === false, "manual auth capability");
      assert(manualCapabilities.supportsLastMessage === true, "manual last-message capability");

      let unsupportedCapabilitiesError;
      try {
        getAdapterCapabilities("not-real");
      } catch (error) {
        unsupportedCapabilitiesError = error;
      }
      assert(
        unsupportedCapabilitiesError && unsupportedCapabilitiesError.message === "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec, manual.",
        "unsupported adapter capability lookup should fail through registry validation",
      );

      const execUnsupported = cewp(["run", "dispatch", "exec", "worker-a", "--adapter", "not-real", "--dry-run"], cewpRoot);
      assertExit(execUnsupported, 1, "unsupported dispatch exec adapter");
      assertIncludes(execUnsupported.stderr, "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec, manual.", "unsupported exec adapter message");

      const pipelineUnsupported = cewp(["run", "dispatch", "pipeline", "--adapter", "not-real", "--dry-run"], cewpRoot);
      assertExit(pipelineUnsupported, 1, "unsupported dispatch pipeline adapter");
      assertIncludes(pipelineUnsupported.stderr, "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec, manual.", "unsupported pipeline adapter message");
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
          lastMessage: "adapter-output/worker-a-last-message.md",
        },
      });

      assert(result.adapter === "codex-exec", "adapter result adapter name");
      assert(result.provider === "codex-exec", "adapter result provider");
      assert(result.schemaVersion === "adapter-result/v1", "adapter result schema version");
      assert(result.role === "worker-a", "adapter result role");
      assert(result.status === "FAIL", "adapter result status");
      assert(result.ok === false, "adapter result ok false");
      assert(result.exitCode === 7, "adapter result exit code");
      assert(result.timedOut === false, "adapter result timeout");
      assert(result.reason === "codex exec exited with code 7.", "adapter result reason");
      assert(Array.isArray(result.reasons) && result.reasons.length === 1, "adapter result reasons");
      assert(result.paths.stdout === "adapter-output/worker-a-stdout.log", "adapter result paths");
      assert(result.lastMessagePath === "adapter-output/worker-a-last-message.md", "adapter result last message path");
      assert(result.commandExecuted === true, "adapter result command executed");
      assert(result.externalCommandExecuted === true, "adapter result external command executed");
      assert(result.artifacts.some((artifact) => artifact.type === "stdout-log" && artifact.role === "worker-a"), "adapter result stdout artifact");
      assert(result.capabilitiesUsed.includes("externalCommand"), "adapter result external command capability used");
      assert(result.capabilitiesUsed.includes("lastMessage"), "adapter result last-message capability used");

      const resultRepo = makeTempRepo("cewp-harness-adapter-result-");
      tempRepos.push(resultRepo);
      const resultRunRoot = path.join(resultRepo, ".cewp", "runs", "20260616-000000");
      const resultStdoutPath = path.join(resultRunRoot, "adapter-output", "worker-a-stdout.log");
      const resultLastMessagePath = path.join(resultRunRoot, "adapter-output", "worker-a-last-message.md");
      writeFile(resultStdoutPath, "fake stdout\n");
      writeFile(resultLastMessagePath, "fake last message\n");
      const runtimeResult = normalizeAdapterResult({
        role: "worker-a",
        status: "PASS",
        exitCode: 0,
        paths: {
          stdout: resultStdoutPath,
          lastMessage: resultLastMessagePath,
        },
        runRoot: resultRunRoot,
      });
      assert(runtimeResult.ok === true, "adapter runtime result ok true");
      assert(runtimeResult.lastMessagePath === "adapter-output/worker-a-last-message.md", "adapter runtime result relative last message path");
      assert(runtimeResult.artifacts.some((artifact) => artifact.type === "stdout-log" && artifact.present === true), "adapter runtime result stdout present");
      assert(runtimeResult.artifacts.some((artifact) => artifact.type === "last-message" && artifact.present === true), "adapter runtime result last-message present");

      const manualResult = normalizeManualAdapterResult({
        role: "worker-a",
        status: "FAIL",
        exitCode: 1,
        reasons: ["manual action required; adapter did not execute code."],
        paths: {
          handoff: "manual/worker-a.md",
          lastMessage: "adapter-output/worker-a-last-message.md",
        },
      });
      assert(manualResult.adapter === "manual", "manual adapter result adapter name");
      assert(manualResult.provider === "manual", "manual adapter result provider");
      assert(manualResult.schemaVersion === "adapter-result/v1", "manual adapter result schema version");
      assert(manualResult.status === "FAIL", "manual adapter result status");
      assert(manualResult.ok === false, "manual adapter result ok false");
      assert(manualResult.commandExecuted === false, "manual adapter result command not executed");
      assert(manualResult.externalCommandExecuted === false, "manual adapter result external command not executed");
      assert(manualResult.lastMessagePath === "adapter-output/worker-a-last-message.md", "manual adapter result last message path");
      assert(manualResult.paths.handoff === "manual/worker-a.md", "manual adapter result paths");
      assert(manualResult.artifacts.some((artifact) => artifact.type === "manual-handoff" && artifact.role === "worker-a"), "manual adapter result handoff artifact");
      assert(manualResult.capabilitiesUsed.includes("manualHandoff"), "manual adapter result handoff capability used");
      assert(manualResult.capabilitiesUsed.includes("lastMessage"), "manual adapter result last-message capability used");
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
          "worker-a": { provider: "manual" },
          reviewer: { provider: "codex-exec" },
        },
      });
      assert(explicit["worker-a"].provider === "manual", "explicit worker-a manual provider");
      assert(explicit.reviewer.provider === "codex-exec", "explicit reviewer provider");
      assert(explicit["worker-b"].provider === "codex-exec", "default worker-b provider remains");
      assert(
        resolveAdapterProviderForRole({ role: "worker-a", adapterName: "manual", commandName: "dispatch exec", requireAdapter: true }) === "manual",
        "resolve worker-a adapter provider",
      );

      let unsupportedProviderError;
      try {
        normalizeAdapterConfig({ roles: { "worker-a": { provider: "not-real" } } });
      } catch (error) {
        unsupportedProviderError = error;
      }
      assert(
        unsupportedProviderError && unsupportedProviderError.message === "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec, manual.",
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

    await step("adapter config file defaults", () => {
      const defaultConfigRepo = makeTempRepo("cewp-harness-adapter-default-");
      tempRepos.push(defaultConfigRepo);
      const loadedDefaults = loadAdapterConfig(defaultConfigRepo);
      for (const role of ["manager", "worker-a", "worker-b", "reviewer"]) {
        assert(loadedDefaults[role].provider === "codex-exec", "file default adapter provider for " + role);
      }
    });

    await step("adapter config file dispatch resolution dry-run", () => {
      const validConfigRepo = makeTempRepo("cewp-harness-adapter-file-");
      tempRepos.push(validConfigRepo);
      const { runId } = setupFakeAdapterRun(validConfigRepo);
      writeJson(path.join(validConfigRepo, "cewp.config.json"), {
        adapters: {
          manager: { provider: "codex-exec" },
          "worker-a": { provider: "codex-exec" },
          "worker-b": { provider: "codex-exec" },
          reviewer: { provider: "codex-exec" },
        },
      });

      const workerADryRun = cewp(["run", "dispatch", "exec", "worker-a", "--run", runId, "--dry-run"], validConfigRepo);
      assertExit(workerADryRun, 0, "config file worker-a dry-run");
      assertIncludes(workerADryRun.stdout, "Role: worker-a", "config file worker-a role");
      assertIncludes(workerADryRun.stdout, "Adapter: codex-exec", "config file worker-a adapter");

      const workerBDryRun = cewp(["run", "dispatch", "exec", "worker-b", "--run", runId, "--dry-run"], validConfigRepo);
      assertExit(workerBDryRun, 0, "config file worker-b dry-run");
      assertIncludes(workerBDryRun.stdout, "Role: worker-b", "config file worker-b role");
      assertIncludes(workerBDryRun.stdout, "Adapter: codex-exec", "config file worker-b adapter");

      makeReport(validConfigRepo, runId, "worker-a", "README.md");
      makeReport(validConfigRepo, runId, "worker-b", "docs/install.md");
      assertExit(cewp(["run", "collect", "--run", runId], validConfigRepo), 0, "config file collect");

      const reviewerDryRun = cewp(["run", "dispatch", "exec", "reviewer", "--run", runId, "--dry-run"], validConfigRepo);
      assertExit(reviewerDryRun, 0, "config file reviewer dry-run");
      assertIncludes(reviewerDryRun.stdout, "Role: reviewer", "config file reviewer role");
      assertIncludes(reviewerDryRun.stdout, "Adapter: codex-exec", "config file reviewer adapter");

      const workersDryRun = cewp(["run", "dispatch", "exec", "workers", "--run", runId, "--dry-run"], validConfigRepo);
      assertExit(workersDryRun, 0, "config file workers dry-run");
      assertIncludes(workersDryRun.stdout, "CEWP Coordinator Mode dispatch workers dry-run", "config file workers dry-run header");
      assertIncludes(workersDryRun.stdout, "Role: worker-a", "config file workers worker-a role");
      assertIncludes(workersDryRun.stdout, "Role: worker-b", "config file workers worker-b role");
      assertIncludes(workersDryRun.stdout, "Adapter: codex-exec", "config file workers adapter");

      const pipelineDryRun = cewp(["run", "dispatch", "pipeline", "--run", runId, "--dry-run"], validConfigRepo);
      assertExit(pipelineDryRun, 0, "config file pipeline dry-run");
      assertIncludes(pipelineDryRun.stdout, "CEWP Coordinator Mode dispatch pipeline", "config file pipeline header");
      assertIncludes(pipelineDryRun.stdout, "Adapter: codex-exec", "config file pipeline adapter");
      assertIncludes(pipelineDryRun.stdout, "Overall dry-run:", "config file pipeline overall");

      writeJson(path.join(validConfigRepo, "cewp.config.json"), {
        adapters: {
          "worker-a": { provider: "not-real" },
        },
      });
      const overrideDryRun = cewp(["run", "dispatch", "exec", "worker-a", "--run", runId, "--adapter", "codex-exec", "--dry-run"], validConfigRepo);
      assertExit(overrideDryRun, 0, "config file cli adapter override dry-run");
      assertIncludes(overrideDryRun.stdout, "Adapter: codex-exec", "config file cli adapter override");
    });

    await step("adapter config file failure paths", () => {
      const unsupportedRepo = makeTempRepo("cewp-harness-adapter-unsupported-");
      tempRepos.push(unsupportedRepo);
      writeJson(path.join(unsupportedRepo, "cewp.config.json"), {
        adapters: {
          "worker-a": { provider: "not-real" },
        },
      });
      const unsupported = cewp(["run", "dispatch", "exec", "worker-a", "--dry-run"], unsupportedRepo);
      assertExit(unsupported, 1, "unsupported config provider");
      assertIncludes(unsupported.stderr, "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec, manual.", "unsupported config provider message");

      const unsupportedWorkers = cewp(["run", "dispatch", "exec", "workers", "--dry-run"], unsupportedRepo);
      assertExit(unsupportedWorkers, 1, "unsupported config provider workers");
      assertIncludes(unsupportedWorkers.stderr, "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec, manual.", "unsupported config provider workers message");

      const unsupportedPipeline = cewp(["run", "dispatch", "pipeline", "--dry-run"], unsupportedRepo);
      assertExit(unsupportedPipeline, 1, "unsupported config provider pipeline");
      assertIncludes(unsupportedPipeline.stderr, "Unsupported dispatch adapter: not-real. Supported adapter: codex-exec, manual.", "unsupported config provider pipeline message");

      const invalidJsonRepo = makeTempRepo("cewp-harness-adapter-invalid-json-");
      tempRepos.push(invalidJsonRepo);
      writeFile(path.join(invalidJsonRepo, "cewp.config.json"), "{ invalid json\n");
      const invalidJson = cewp(["run", "dispatch", "exec", "worker-a", "--dry-run"], invalidJsonRepo);
      assertExit(invalidJson, 1, "invalid config json");
      assertIncludes(invalidJson.stderr, "Invalid cewp.config.json JSON:", "invalid config json message");
      assertIncludes(invalidJson.stderr, "cewp.config.json", "invalid config json path");

      const invalidJsonWorkers = cewp(["run", "dispatch", "exec", "workers", "--dry-run"], invalidJsonRepo);
      assertExit(invalidJsonWorkers, 1, "invalid config json workers");
      assertIncludes(invalidJsonWorkers.stderr, "Invalid cewp.config.json JSON:", "invalid config json workers message");

      const invalidJsonPipeline = cewp(["run", "dispatch", "pipeline", "--dry-run"], invalidJsonRepo);
      assertExit(invalidJsonPipeline, 1, "invalid config json pipeline");
      assertIncludes(invalidJsonPipeline.stderr, "Invalid cewp.config.json JSON:", "invalid config json pipeline message");
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

    await step("manual adapter worker handoff", () => {
      const manualRepo = makeTempRepo("cewp-harness-manual-worker-");
      tempRepos.push(manualRepo);
      const { runId } = setupFakeAdapterRun(manualRepo);

      const dryRun = cewp(["run", "dispatch", "exec", "worker-a", "--run", runId, "--adapter", "manual", "--dry-run"], manualRepo);
      assertExit(dryRun, 0, "manual worker dry-run");
      assertIncludes(dryRun.stdout, "Adapter: manual", "manual dry-run adapter");
      assertIncludes(dryRun.stdout, "Manual adapter preview:", "manual dry-run preview");
      assertIncludes(dryRun.stdout, "Manual handoff: manual/worker-a.md", "manual dry-run handoff path");
      assertIncludes(dryRun.stdout, "External command: not executed", "manual dry-run external command");

      const workersDryRun = cewp(["run", "dispatch", "exec", "workers", "--run", runId, "--adapter", "manual", "--dry-run"], manualRepo);
      assertExit(workersDryRun, 0, "manual workers dry-run");
      assertIncludes(workersDryRun.stdout, "Adapter: manual", "manual workers dry-run adapter");

      const pipelineDryRun = cewp(["run", "dispatch", "pipeline", "--run", runId, "--adapter", "manual", "--dry-run"], manualRepo);
      assertExit(pipelineDryRun, 0, "manual pipeline dry-run");
      assertIncludes(pipelineDryRun.stdout, "Adapter: manual", "manual pipeline dry-run adapter");

      const actual = cewp(["run", "dispatch", "exec", "worker-a", "--run", runId, "--adapter", "manual", "--yes"], manualRepo);
      assertExit(actual, 1, "manual worker actual requires manual action");
      assertIncludes(actual.stdout, "Adapter: manual", "manual actual adapter");
      assertIncludes(actual.stdout, "manual action required; adapter did not execute code.", "manual action reason");
      assertIncludes(actual.stdout, "Manual handoff: manual/worker-a.md", "manual actual handoff path");
      assertIncludes(actual.stdout, "External command: not executed", "manual actual external command");
      assertIncludes(actual.stdout, "No merge/push/publish was performed.", "manual no publish guard");

      const manualPath = path.join(manualRepo, ".cewp", "runs", runId, "manual", "worker-a.md");
      const lastMessagePath = path.join(manualRepo, ".cewp", "runs", runId, "adapter-output", "worker-a-last-message.md");
      assertFileExists(manualPath, "manual worker handoff");
      assertFileExists(lastMessagePath, "manual worker last message");
      const manualContent = fs.readFileSync(manualPath, "utf8");
      assertIncludes(manualContent, "The manual adapter did not execute code", "manual handoff non-executing");
      assertIncludes(manualContent, `Role: worker-a`, "manual handoff role");
      assertIncludes(manualContent, `Run ID: ${runId}`, "manual handoff run id");
      assertIncludes(manualContent, `.cewp${path.sep}runs${path.sep}${runId}`, "manual handoff run path");
      assertIncludes(manualContent, "manual action required; adapter did not execute code.", "manual handoff action required");
      assertIncludes(manualContent, "External command: not executed", "manual handoff external command");
      assertIncludes(manualContent, "Save your completed result to a Markdown file", "manual handoff result save guidance");
      assertIncludes(manualContent, "Expected CEWP output: reports/worker-a-report.md", "manual handoff expected output path");
      assertIncludes(manualContent, "cewp run dispatch complete worker-a --run", "manual handoff complete command");
      assertIncludes(manualContent, "--from <file>", "manual handoff complete from placeholder");
      assertIncludes(manualContent, "## Dispatch Prompt", "manual handoff prompt");

      const manualRuntimeResult = normalizeManualAdapterResult({
        role: "worker-a",
        status: "FAIL",
        exitCode: 1,
        reasons: ["manual action required; adapter did not execute code."],
        paths: {
          handoff: manualPath,
          lastMessage: lastMessagePath,
        },
        runRoot: path.join(manualRepo, ".cewp", "runs", runId),
      });
      assert(manualRuntimeResult.schemaVersion === "adapter-result/v1", "manual runtime result schema version");
      assert(manualRuntimeResult.lastMessagePath === "adapter-output/worker-a-last-message.md", "manual runtime result last message path");
      assert(manualRuntimeResult.artifacts.some((artifact) => artifact.type === "manual-handoff" && artifact.present === true), "manual runtime result handoff present");
      assert(manualRuntimeResult.artifacts.some((artifact) => artifact.type === "last-message" && artifact.present === true), "manual runtime result last-message present");

      const missingStatus = cewp(["run", "status", "20260529-999999"], manualRepo);
      assertExit(missingStatus, 1, "operator status missing run");
      assertIncludes(missingStatus.stderr, "CEWP run not found: 20260529-999999", "operator status missing run message");

      const runRoot = path.join(manualRepo, ".cewp", "runs", runId);
      const missingNext = cewp(["run", "next", "20260529-999999"], manualRepo);
      assertExit(missingNext, 1, "operator next missing run");
      assertIncludes(missingNext.stderr, "CEWP run not found: 20260529-999999", "operator next missing run message");

      const missingResume = cewp(["run", "resume", "20260529-999999"], manualRepo);
      assertExit(missingResume, 1, "operator resume missing run");
      assertIncludes(missingResume.stderr, "CEWP run not found: 20260529-999999", "operator resume missing run message");

      const beforeStatus = snapshotRunFiles(runRoot);
      const statusWithHandoff = cewp(["run", "status", runId], manualRepo);
      const afterStatus = snapshotRunFiles(runRoot);
      assertExit(statusWithHandoff, 0, "operator status manual handoff");
      assertSnapshotsEqual(beforeStatus, afterStatus, "operator status should be read-only");
      assertIncludes(statusWithHandoff.stdout, "CEWP Coordinator Mode status", "operator status heading");
      assertIncludes(statusWithHandoff.stdout, `Run ID: ${runId}`, "operator status run id");
      assertIncludes(statusWithHandoff.stdout, "Artifacts:", "operator status artifacts");
      assertIncludes(statusWithHandoff.stdout, "manual handoff: manual/worker-a.md", "operator status handoff path");
      assertIncludes(statusWithHandoff.stdout, "last message: adapter-output/worker-a-last-message.md", "operator status last message path");
      assertIncludes(statusWithHandoff.stdout, "Manual handoffs: manual/worker-a.md", "operator status manual inventory");
      assertIncludes(statusWithHandoff.stdout, "Last-message markers: adapter-output/worker-a-last-message.md", "operator status last-message inventory");
      assertIncludes(statusWithHandoff.stdout, "Event files:", "operator status event files");
      assertIncludes(statusWithHandoff.stdout, "Events:", "operator status event count");
      assertIncludes(statusWithHandoff.stdout, "Next suggested actions:", "operator status next actions heading");
      assertIncludes(statusWithHandoff.stdout, `cewp run dispatch complete worker-a --run ${runId} --from <file>`, "operator status manual completion hint");

      const statusWithHandoffJson = cewp(["run", "status", runId, "--json"], manualRepo);
      assertExit(statusWithHandoffJson, 0, "operator status manual handoff json");
      const statusWithHandoffValue = parseJsonOutput(statusWithHandoffJson, "operator status manual handoff json");
      assert(statusWithHandoffValue.command === "run status", "operator status json command");
      assert(statusWithHandoffValue.runId === runId, "operator status json run id");
      assert(typeof statusWithHandoffValue.runPath === "string" && statusWithHandoffValue.runPath.includes(runId), "operator status json run path");
      assert(statusWithHandoffValue.latest === true, "operator status json latest marker");
      assert(statusWithHandoffValue.artifacts.manualHandoffs.present === true, "operator status json manual present");
      assert(statusWithHandoffValue.artifacts.reports.present === false, "operator status json reports absent");
      assert(statusWithHandoffValue.artifacts.events.fileCount > 0, "operator status json event files");
      assert(statusWithHandoffValue.reviewer.pass === false, "operator status json reviewer pass false");
      assert(statusWithHandoffValue.nextAction.label === "complete-manual", "operator status json next label");
      assertIncludes(statusWithHandoffValue.nextAction.command, `cewp run dispatch complete worker-a --run ${runId}`, "operator status json next command");

      const beforeNext = snapshotRunFiles(runRoot);
      const nextWithHandoff = cewp(["run", "next", runId], manualRepo);
      const afterNext = snapshotRunFiles(runRoot);
      assertExit(nextWithHandoff, 0, "operator next manual handoff");
      assertSnapshotsEqual(beforeNext, afterNext, "operator next should be read-only");
      assertIncludes(nextWithHandoff.stdout, "CEWP Coordinator Mode next", "operator next heading");
      assertIncludes(nextWithHandoff.stdout, `Run ID: ${runId}`, "operator next run id");
      assertIncludes(nextWithHandoff.stdout, "Current state:", "operator next state summary");
      assertIncludes(nextWithHandoff.stdout, `Recommended command: cewp run dispatch complete worker-a --run ${runId} --from <file>`, "operator next manual completion command");
      assertIncludes(nextWithHandoff.stdout, "Reason: worker-a has a manual handoff but its expected report is missing.", "operator next manual completion reason");

      const nextWithHandoffJson = cewp(["run", "next", runId, "--json"], manualRepo);
      assertExit(nextWithHandoffJson, 0, "operator next manual handoff json");
      const nextWithHandoffValue = parseJsonOutput(nextWithHandoffJson, "operator next manual handoff json");
      assert(nextWithHandoffValue.command === "run next", "operator next json command");
      assert(nextWithHandoffValue.runId === runId, "operator next json run id");
      assert(nextWithHandoffValue.artifacts.manualHandoffs.present === true, "operator next json manual present");
      assert(nextWithHandoffValue.nextAction.label === "complete-manual", "operator next json next label");
      assertIncludes(nextWithHandoffValue.nextAction.reason, "manual handoff", "operator next json next reason");

      const beforeResume = snapshotRunFiles(runRoot);
      const resumeWithHandoff = cewp(["run", "resume", runId], manualRepo);
      const afterResume = snapshotRunFiles(runRoot);
      assertExit(resumeWithHandoff, 0, "operator resume manual handoff");
      assertSnapshotsEqual(beforeResume, afterResume, "operator resume should be read-only");
      assertIncludes(resumeWithHandoff.stdout, "# CEWP Run Resume", "operator resume heading");
      assertIncludes(resumeWithHandoff.stdout, `Run ID: ${runId}`, "operator resume run id");
      assertIncludes(resumeWithHandoff.stdout, "Run path:", "operator resume run path");
      assertIncludes(resumeWithHandoff.stdout, "## Current State", "operator resume current state");
      assertIncludes(resumeWithHandoff.stdout, "## Artifacts", "operator resume artifacts");
      assertIncludes(resumeWithHandoff.stdout, "- Manual handoffs: yes (1)", "operator resume manual handoff presence");
      assertIncludes(resumeWithHandoff.stdout, "- Worker reports: no (0)", "operator resume worker reports absent");
      assertIncludes(resumeWithHandoff.stdout, "- Reviewer PASS: no", "operator resume reviewer pass false");
      assertIncludes(resumeWithHandoff.stdout, `- Command: cewp run dispatch complete worker-a --run ${runId} --from <file>`, "operator resume manual completion command");
      assertIncludes(resumeWithHandoff.stdout, "- Reason: worker-a has a manual handoff but its expected report is missing.", "operator resume manual completion reason");
      assertIncludes(resumeWithHandoff.stdout, "## Manual Completion", "operator resume manual completion section");
      assertIncludes(resumeWithHandoff.stdout, `cewp run status ${runId}`, "operator resume status follow-up");
      assertIncludes(resumeWithHandoff.stdout, `cewp run next ${runId}`, "operator resume next follow-up");
      assertIncludes(resumeWithHandoff.stdout, "cewp run list", "operator resume list follow-up");

      const resumeWithHandoffJson = cewp(["run", "resume", runId, "--json"], manualRepo);
      assertExit(resumeWithHandoffJson, 0, "operator resume manual handoff json");
      const resumeWithHandoffValue = parseJsonOutput(resumeWithHandoffJson, "operator resume manual handoff json");
      assert(resumeWithHandoffValue.command === "run resume", "operator resume json command");
      assert(resumeWithHandoffValue.runId === runId, "operator resume json run id");
      assert(resumeWithHandoffValue.artifacts.manualHandoffs.present === true, "operator resume json manual present");
      assert(resumeWithHandoffValue.nextAction.label === "complete-manual", "operator resume json next label");
      assert(resumeWithHandoffValue.resume.manualCompletionCommands.length === 1, "operator resume json manual completion commands");
      assertIncludes(resumeWithHandoffValue.resume.manualCompletionCommands[0], `cewp run dispatch complete worker-a --run ${runId}`, "operator resume json manual completion command");
      assertIncludes(resumeWithHandoffValue.resume.followUpCommands, `cewp run status ${runId}`, "operator resume json status follow-up");

      const manualResultPath = path.join(manualRepo, "manual-result-worker-a.md");
      writeFile(
        manualResultPath,
        "# Worker Report\n\nRole: worker-a\nStatus: ready_for_review\n\nManual completion recorded by harness.\n",
      );
      const complete = cewp(["run", "dispatch", "complete", "worker-a", "--run", runId, "--from", manualResultPath], manualRepo);
      assertExit(complete, 0, "manual worker complete");
      assertIncludes(complete.stdout, "Manual result recorded", "manual complete message");
      assertIncludes(complete.stdout, "Report: reports/worker-a-report.md", "manual complete report path");
      assertIncludes(complete.stdout, "Last message: adapter-output/worker-a-last-message.md", "manual complete last-message path");

      const reportPath = path.join(manualRepo, ".cewp", "runs", runId, "reports", "worker-a-report.md");
      assertFileExists(reportPath, "manual complete worker report");
      assertIncludes(fs.readFileSync(reportPath, "utf8"), "Manual completion recorded by harness.", "manual complete report content");
      assertIncludes(fs.readFileSync(lastMessagePath, "utf8"), "Manual result recorded", "manual complete last message");

      const statusWithReport = cewp(["run", "status", "--run", runId], manualRepo);
      assertExit(statusWithReport, 0, "operator status worker report");
      assertIncludes(statusWithReport.stdout, "report: reports/worker-a-report.md", "operator status worker report presence");
      assertIncludes(statusWithReport.stdout, "Reports: reports/worker-a-report.md", "operator status report inventory");
      assertIncludes(statusWithReport.stdout, `cewp run collect --run ${runId}`, "operator status collect hint");

      const nextWithReport = cewp(["run", "next", "--run", runId], manualRepo);
      assertExit(nextWithReport, 0, "operator next worker report");
      assertIncludes(nextWithReport.stdout, `Recommended command: cewp run collect --run ${runId}`, "operator next collect command");
      assertIncludes(nextWithReport.stdout, "Reason: Worker reports exist but no review packet has been collected.", "operator next collect reason");

      const nextWithReportJson = cewp(["run", "next", "--run", runId, "--json"], manualRepo);
      assertExit(nextWithReportJson, 0, "operator next worker report json");
      const nextWithReportValue = parseJsonOutput(nextWithReportJson, "operator next worker report json");
      assert(nextWithReportValue.artifacts.reports.present === true, "operator next json report present");
      assert(nextWithReportValue.nextAction.label === "collect", "operator next json collect label");

      const collect = cewp(["run", "collect", "--run", runId], manualRepo);
      assertExit(collect, 0, "manual complete collect");
      const packetPath = path.join(manualRepo, ".cewp", "runs", runId, "review-packets", "review-packet.md");
      assertIncludes(fs.readFileSync(packetPath, "utf8"), "Manual completion recorded by harness.", "manual complete packet content");

      const nextWithPacket = cewp(["run", "next", "--run", runId], manualRepo);
      assertExit(nextWithPacket, 0, "operator next review packet");
      assertIncludes(nextWithPacket.stdout, `Recommended command: cewp run dispatch exec reviewer --run ${runId} --dry-run`, "operator next reviewer dry-run command");
      assertIncludes(nextWithPacket.stdout, "Reason: A review packet exists but no reviewer report is present.", "operator next reviewer dry-run reason");

      writeFile(
        path.join(manualRepo, ".cewp", "runs", runId, "reviews", "reviewer-report.md"),
        "# Reviewer Report\n\nDecision: PASS\n\nReady to finalize.\n",
      );
      const statusWithPassReview = cewp(["run", "status", "--run", runId], manualRepo);
      assertExit(statusWithPassReview, 0, "operator status reviewer PASS");
      assertIncludes(statusWithPassReview.stdout, "report: reviews/reviewer-report.md", "operator status reviewer report presence");
      assertIncludes(statusWithPassReview.stdout, `cewp run finalize --run ${runId} --dry-run`, "operator status finalize hint");

      const nextWithPassReview = cewp(["run", "next", "--run", runId], manualRepo);
      assertExit(nextWithPassReview, 0, "operator next reviewer PASS");
      assertIncludes(nextWithPassReview.stdout, `Recommended command: cewp run finalize --run ${runId} --dry-run`, "operator next finalize dry-run command");
      assertIncludes(nextWithPassReview.stdout, "Reason: Reviewer report reviews/reviewer-report.md contains Decision: PASS.", "operator next finalize reason");

      const resumeWithPassReview = cewp(["run", "resume", "--run", runId], manualRepo);
      assertExit(resumeWithPassReview, 0, "operator resume reviewer PASS");
      assertIncludes(resumeWithPassReview.stdout, "- Reviewer PASS: yes", "operator resume reviewer pass true");
      assertIncludes(resumeWithPassReview.stdout, `- Command: cewp run finalize --run ${runId} --dry-run`, "operator resume finalize dry-run command");
      assertIncludes(resumeWithPassReview.stdout, "- Reason: Reviewer report reviews/reviewer-report.md contains Decision: PASS.", "operator resume finalize reason");

      const statusWithPassReviewJson = cewp(["run", "status", "--run", runId, "--json"], manualRepo);
      assertExit(statusWithPassReviewJson, 0, "operator status reviewer PASS json");
      const statusWithPassReviewValue = parseJsonOutput(statusWithPassReviewJson, "operator status reviewer PASS json");
      assert(statusWithPassReviewValue.artifacts.reviews.present === true, "operator status json review present");
      assert(statusWithPassReviewValue.reviewer.pass === true, "operator status json reviewer pass");
      assert(statusWithPassReviewValue.nextAction.label === "finalize-dry-run", "operator status json finalize label");

      const nextWithPassReviewJson = cewp(["run", "next", "--run", runId, "--json"], manualRepo);
      assertExit(nextWithPassReviewJson, 0, "operator next reviewer PASS json");
      const nextWithPassReviewValue = parseJsonOutput(nextWithPassReviewJson, "operator next reviewer PASS json");
      assert(nextWithPassReviewValue.reviewer.pass === true, "operator next json reviewer pass");
      assert(nextWithPassReviewValue.nextAction.label === "finalize-dry-run", "operator next json finalize label");

      const resumeWithPassReviewJson = cewp(["run", "resume", "--run", runId, "--json"], manualRepo);
      assertExit(resumeWithPassReviewJson, 0, "operator resume reviewer PASS json");
      const resumeWithPassReviewValue = parseJsonOutput(resumeWithPassReviewJson, "operator resume reviewer PASS json");
      assert(resumeWithPassReviewValue.reviewer.pass === true, "operator resume json reviewer pass");
      assert(resumeWithPassReviewValue.nextAction.label === "finalize-dry-run", "operator resume json finalize label");
      assert(resumeWithPassReviewValue.resume.recommendedCommand === `cewp run finalize --run ${runId} --dry-run`, "operator resume json recommended command");

      const missing = cewp(["run", "dispatch", "complete", "worker-a", "--run", runId, "--from", path.join(manualRepo, "missing.md")], manualRepo);
      assertExit(missing, 1, "manual complete missing file");
      assertIncludes(missing.stderr, "manual completion source file missing", "manual complete missing file message");
    });

    coordinatorRepo = makeTempRepo("cewp-harness-flow-");
    tempRepos.push(coordinatorRepo);
    let flowRunId;
    let flowRegistry;

    await step("temp repo init", () => {
      flowRunId = createTwoTaskRun(coordinatorRepo);
      const runRoot = path.join(coordinatorRepo, ".cewp", "runs", flowRunId);
      assertFileExists(path.join(runRoot, "run.json"), "run.json");

      const beforeNext = snapshotRunFiles(runRoot);
      const next = cewp(["run", "next"], coordinatorRepo);
      const afterNext = snapshotRunFiles(runRoot);
      assertExit(next, 0, "operator next no safe action");
      assertSnapshotsEqual(beforeNext, afterNext, "operator next no safe action should be read-only");
      assertIncludes(next.stdout, "Recommended command: none", "operator next no safe command");
      assertIncludes(next.stdout, "Reason: no safe next action found.", "operator next no safe reason");

      const nextJson = cewp(["run", "next", "--json"], coordinatorRepo);
      assertExit(nextJson, 0, "operator next no safe action json");
      const nextJsonValue = parseJsonOutput(nextJson, "operator next no safe action json");
      assert(nextJsonValue.command === "run next", "operator next no safe json command");
      assert(nextJsonValue.nextAction === null, "operator next no safe json next action");
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
      assert(packageJson.version === "0.5.0-beta.0", `unexpected package version: ${packageJson.version}`);
      assert(packOutput.includes("docs/adapter-contract.md"), "adapter contract doc should be packed");
      assert(!packOutput.includes(".cewp/"), ".cewp/ should not be packed");
      assert(!packOutput.includes(".cewp-worktrees/"), ".cewp-worktrees/ should not be packed");
      assert(!packOutput.includes(".ctxo/"), ".ctxo/ should not be packed");
      assert(!packOutput.includes(".codegraph/"), ".codegraph/ should not be packed");
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
