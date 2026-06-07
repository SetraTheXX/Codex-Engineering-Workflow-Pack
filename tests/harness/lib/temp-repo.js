"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function run(command, args = [], options = {}) {
  const useShell = process.platform === "win32" && command === "npm";
  const executable = useShell ? ["npm", ...args].join(" ") : command;
  const executableArgs = useShell ? [] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    shell: useShell,
    timeout: options.timeout || 120000,
  });

  return {
    command: [command, ...args].join(" "),
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error ? `${result.stderr || ""}${result.error ? result.error.message : ""}` : "",
  };
}

function runNode(scriptPath, args = [], cwd, options = {}) {
  return run(process.execPath, [scriptPath, ...args], { ...options, cwd });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTempRepo(prefix = "cewp-harness-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  writeFile(path.join(root, "README.md"), "# Harness Repo\n\nInitial README.\n");
  writeFile(path.join(root, "docs", "install.md"), "# Install\n\nInitial install docs.\n");
  writeFile(path.join(root, ".gitignore"), ".cewp/\n.cewp-worktrees/\n.cewp-worker-output/\n");
  writeFile(path.join(root, "package.json"), "{\"private\":true}\n");

  run("git", ["init"], { cwd: root });
  run("git", ["config", "user.email", "cewp-harness@example.local"], { cwd: root });
  run("git", ["config", "user.name", "CEWP Harness"], { cwd: root });
  run("git", ["add", "."], { cwd: root });
  run("git", ["commit", "-m", "test: initial temp repo"], { cwd: root });

  return root;
}

function listRunIds(repoRoot) {
  const runsRoot = path.join(repoRoot, ".cewp", "runs");
  if (!fs.existsSync(runsRoot)) {
    return [];
  }

  return fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function latestRunId(repoRoot) {
  const runIds = listRunIds(repoRoot);
  return runIds[runIds.length - 1];
}

function taskFixture({ id, assignedRole, allowedFiles, forbiddenFiles, mission, runId, repoName }) {
  return {
    id,
    title: `${assignedRole} harness task`,
    assignedRole,
    status: "todo",
    mission,
    allowedFiles,
    forbiddenFiles,
    branch: `cewp/${runId}/${id}`,
    targetWorktree: `../.cewp-worktrees/${repoName}/${runId}/${id}`,
    verification: ["git diff --name-only"],
  };
}

function writeTask(repoRoot, runId, task) {
  writeJson(path.join(repoRoot, ".cewp", "runs", runId, "tasks", `${task.id}.json`), task);
}

function readWorktrees(repoRoot, runId) {
  return readJson(path.join(repoRoot, ".cewp", "runs", runId, "worktrees.json"));
}

function cleanupRepo(repoRoot) {
  if (!repoRoot || !fs.existsSync(repoRoot)) {
    return;
  }

  run("git", ["worktree", "prune"], { cwd: repoRoot });
  const list = run("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
  const paths = list.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((worktreePath) => path.resolve(worktreePath) !== path.resolve(repoRoot));

  for (const worktreePath of paths) {
    run("git", ["worktree", "remove", "--force", worktreePath], { cwd: repoRoot });
  }

  run("git", ["worktree", "prune"], { cwd: repoRoot });
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

module.exports = {
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
};
