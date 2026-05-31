#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { readJsonIfExists, readJsonFile } = require("../src/lib/json");
const { listFiles } = require("../src/lib/fs");
const {
  isGitWorktreePath,
  getGitStatusShort,
  getCommittedChangedFiles,
} = require("../src/lib/git");
const { getRunsRoot, validateRunId, normalizeComparePath } = require("../src/lib/paths");
const {
  parseChangedFile,
  uniqueFileList,
  isWorkerRuntimeOutputPath,
  findScopeWarnings,
  getAllowedFilesOverlap,
} = require("../src/lib/scope-check");
const { runCleanup } = require("../src/run/cleanup");
const { runPrune } = require("../src/run/prune");
const {
  runWorktreesPlan,
  runWorktreesCreate,
  runWorktreesStatus,
} = require("../src/run/worktrees");
const {
  runInit,
  runStatus,
  runPrompts,
  runPrompt,
} = require("../src/run/basic");
const { runFinalize } = require("../src/run/finalize");
const { runCollect } = require("../src/run/collect");
const { runDispatchPlan } = require("../src/run/dispatch/plan");
const { runDispatchCheck } = require("../src/run/dispatch/check");
const { runDispatchPrompts } = require("../src/run/dispatch/prompts");
const { runDispatchStart } = require("../src/run/dispatch/start");
const {
  relativeRunPath,
  getDispatchWorktree,
  getWorkerTaskForRole,
  getDispatchPromptPathForTask,
} = require("../src/run/dispatch/shared");
const { usage } = require("../src/cli/usage");
const { parseArgs } = require("../src/cli/parse");
const { printCliError } = require("../src/cli/errors");
const { init } = require("../src/skills/install");
const { list, doctor } = require("../src/skills/status");

function findLatestRun(repoRoot = process.cwd()) {
  const runsRoot = getRunsRoot(repoRoot);

  if (!fs.existsSync(runsRoot)) {
    throw new Error(`No CEWP runs found. Missing directory: ${runsRoot}`);
  }

  const runIds = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (runIds.length === 0) {
    throw new Error(`No CEWP runs found under: ${runsRoot}`);
  }

  const runId = runIds[runIds.length - 1];
  return {
    runId,
    runRoot: path.join(runsRoot, runId),
  };
}

function findRun(options = {}, repoRoot = process.cwd()) {
  if (!options.runId) {
    return findLatestRun(repoRoot);
  }

  validateRunId(options.runId);

  const runsRoot = getRunsRoot(repoRoot);
  const runRoot = path.join(runsRoot, options.runId);

  if (!fs.existsSync(runRoot)) {
    throw new Error(`CEWP run not found: ${options.runId}`);
  }

  return {
    runId: options.runId,
    runRoot,
  };
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function readTaskFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid task JSON: ${filePath}. ${error.message}`);
  }
}

function readTasks(runRoot) {
  return listFiles(path.join(runRoot, "tasks"), ".json").map((filePath) => ({
    filePath,
    task: readTaskFile(filePath),
  }));
}

function appendRunEvent(runRoot, role, event) {
  const eventsRoot = path.join(runRoot, "events");
  fs.mkdirSync(eventsRoot, { recursive: true });
  fs.appendFileSync(
    path.join(eventsRoot, `${role}.jsonl`),
    `${JSON.stringify({ timestamp: new Date().toISOString(), role, ...event })}\n`,
  );
}

function printCodexExecPreview({ cwd, promptPath, outputPath, sandbox }) {
  console.log("PowerShell preview:");
  console.log(`  $prompt = Get-Content -Raw ${quote(promptPath)}`);
  console.log(`  codex exec --cd ${quote(cwd)} --sandbox ${sandbox} --output-last-message ${quote(outputPath)} $prompt`);
}

function getDispatchExecPreview(options) {
  const supportedRoles = ["worker-a", "worker-b", "reviewer"];
  const shouldPrint = options.printPreview !== false;

  if (!options.adapter) {
    throw new Error("dispatch exec requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }

  if (!supportedRoles.includes(options.role)) {
    throw new Error(`Unsupported dispatch exec role: ${options.role || "(missing)"}. Supported roles: worker-a, worker-b, reviewer.`);
  }

  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskEntries = readTasks(runRoot);
  const worktreesRegistry = readWorktreesRegistry(runRoot);
  const dispatchPromptsRoot = path.join(runRoot, "dispatch-prompts");
  const adapterOutputRoot = path.join(runRoot, "adapter-output");
  const outputLastMessagePath = path.join(adapterOutputRoot, `${options.role}-last-message.md`);
  const failures = [];
  const warnings = [];
  let preview;

  if (!runJson) {
    failures.push("run.json missing.");
  }

  if (!boardJson) {
    failures.push("board.json missing.");
  }

  if (taskEntries.length === 0) {
    failures.push("tasks not found. Ask the Manager to create tasks first.");
  }

  if (!worktreesRegistry) {
    failures.push("worktrees.json missing. Run cewp run worktrees create first.");
  }

  if (!fs.existsSync(dispatchPromptsRoot)) {
    if (options.ignoreMissingDispatchPrompts) {
      warnings.push(`dispatch-prompts directory missing; pipeline will run dispatch prompts before execution.`);
    } else {
      failures.push(`dispatch-prompts directory missing. Run: cewp run dispatch prompts --run ${runId}`);
    }
  }

  if (options.role === "reviewer") {
    const promptPath = path.join(dispatchPromptsRoot, "reviewer-prompt.md");
    const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
    const reportPath = path.join(runRoot, "reviews", "reviewer-report.md");
    const eventPath = path.join(runRoot, "events", "reviewer.jsonl");
    const workdir = runRoot;
    const reportFiles = listFiles(path.join(runRoot, "reports"), ".md");

    if (!fs.existsSync(promptPath)) {
      if (options.ignoreMissingDispatchPrompts) {
        warnings.push(`reviewer dispatch prompt missing; pipeline will create it before reviewer execution.`);
      } else {
        failures.push(`reviewer dispatch prompt missing: ${relativeRunPath(runRoot, promptPath)}`);
      }
    }

    if (!fs.existsSync(reviewPacketPath)) {
      if (options.ignoreMissingReviewInputs) {
        warnings.push(`review packet missing; pipeline will run collect before reviewer execution.`);
      } else {
        failures.push(`review packet missing: ${relativeRunPath(runRoot, reviewPacketPath)}. Run cewp run collect first.`);
      }
    }

    if (reportFiles.length === 0) {
      if (options.ignoreMissingReviewInputs) {
        warnings.push("worker reports missing; pipeline will run workers before reviewer execution.");
      } else {
        failures.push("worker reports missing. Run worker execution before reviewer execution.");
      }
    }

    if (!fs.existsSync(workdir)) {
      failures.push(`reviewer working directory missing: ${workdir}`);
    }

    preview = {
      role: options.role,
      cwd: workdir,
      promptPath,
      reportPath,
      eventPath,
      outputLastMessagePath,
      sandbox: "workspace-write",
      reviewPacketPath,
      reportFiles,
    };
  } else if (taskEntries.length > 0) {
    const task = getWorkerTaskForRole(taskEntries, options.role);
    const taskId = task.id || "unknown-task";
    const worktree = getDispatchWorktree(worktreesRegistry, task.id);
    const promptPath = getDispatchPromptPathForTask(runRoot, options.role, taskId);
    const reportPath = path.join(runRoot, "reports", `${options.role}-report.md`);
    const eventPath = path.join(runRoot, "events", `${options.role}.jsonl`);

    if (!task.id) {
      failures.push("task file missing required id.");
    }

    if (!worktree) {
      failures.push(`${taskId} matching worktree missing in worktrees.json.`);
    } else if (!worktree.path) {
      failures.push(`${taskId} worktree path missing.`);
    } else if (!fs.existsSync(worktree.path)) {
      failures.push(`${taskId} worktree path does not exist: ${worktree.path}`);
    } else if (!isGitWorktreePath(worktree.path)) {
      failures.push(`${taskId} path is not a git worktree: ${worktree.path}`);
    }

    if (worktree && !worktree.baseCommit) {
      warnings.push(`${taskId} worktree registry missing baseCommit; committed diff post-check will fail safely.`);
    }

    if (!fs.existsSync(promptPath)) {
      if (options.ignoreMissingDispatchPrompts) {
        warnings.push(`${taskId} dispatch prompt missing; pipeline will create it before worker execution.`);
      } else {
        failures.push(`${taskId} dispatch prompt missing: ${relativeRunPath(runRoot, promptPath)}`);
      }
    }

    preview = {
      role: options.role,
      task,
      worktree,
      cwd: worktree && worktree.path,
      promptPath,
      reportPath,
      eventPath,
      outputLastMessagePath,
      sandbox: "workspace-write",
    };
  }

  if (shouldPrint) {
    console.log("CEWP Coordinator Mode codex-exec adapter dry-run");
    console.log(`Run ID: ${runId}`);
    console.log(`Role: ${options.role}`);
    console.log(`Adapter: ${options.adapter}`);
    console.log(`Mode: ${options.dryRun ? "dry-run" : "execution"}`);
    console.log("");
    console.log(`Readiness: ${failures.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS"}`);
    console.log("");

    if (failures.length > 0) {
      console.log("Failures:");
      for (const failure of failures) {
        console.log(`  - ${failure}`);
      }
      console.log("");
    }

    if (warnings.length > 0) {
      console.log("Warnings:");
      for (const warning of warnings) {
        console.log(`  - ${warning}`);
      }
      console.log("");
    }

    if (preview) {
      if (preview.task) {
        console.log("Task:");
        console.log(`  ${preview.task.id || "unknown-task"} / ${preview.role}`);
        console.log(`  Title: ${preview.task.title || "(untitled)"}`);
        console.log(`  Branch: ${(preview.worktree && preview.worktree.branch) || preview.task.branch || "unknown"}`);
        console.log("");
        console.log("Worktree:");
        console.log(`  ${preview.cwd || "missing"}`);
        console.log("");
      } else {
        console.log("Reviewer:");
        console.log(`  Workdir: ${preview.cwd}`);
        console.log("  Sandbox: workspace-write");
        console.log(`  Review packet: ${relativeRunPath(runRoot, preview.reviewPacketPath)}`);
        console.log(`  Worker reports: ${preview.reportFiles.length}`);
        console.log("");
      }

      console.log("Prompt:");
      console.log(`  ${relativeRunPath(runRoot, preview.promptPath)}`);
      console.log("");
      console.log("Expected outputs:");
      if (preview.task && preview.cwd) {
        const workerOutput = getWorkerOutputPaths(preview.cwd, preview.role);
        console.log(`  Worker report source: ${path.relative(preview.cwd, workerOutput.reportPath).replace(/\\/g, "/")}`);
        console.log(`  Worker events source: ${path.relative(preview.cwd, workerOutput.eventsPath).replace(/\\/g, "/")}`);
      }
      console.log(`  Report: ${relativeRunPath(runRoot, preview.reportPath)}`);
      console.log(`  Event log: ${relativeRunPath(runRoot, preview.eventPath)}`);
      console.log(`  Last message: ${relativeRunPath(runRoot, preview.outputLastMessagePath)}`);
      console.log("");
      console.log("Recommended execution strategy:");
      console.log("  Pass prompt content to codex exec from the dispatch prompt file.");
      console.log("  Do not inline the full prompt in a shell command.");
      console.log("");
      printCodexExecPreview({
        cwd: preview.cwd || "<missing-workdir>",
        promptPath: preview.promptPath,
        outputPath: preview.outputLastMessagePath,
        sandbox: preview.sandbox,
      });
      console.log("");
    }

    console.log("Post-checks:");
    console.log("  git status --short");
    console.log("  git diff --name-only <baseCommit>...HEAD");
    console.log("  allowedFiles / forbiddenFiles");
    console.log("  report exists");
    console.log("  adapter output exists");
    console.log("  no merge/push/publish");
    console.log("");
    console.log("No processes were started.");
    console.log("No files were changed.");
  }

  return {
    runId,
    runRoot,
    runJson,
    taskEntries,
    failures,
    warnings,
    preview,
  };
}

function writeAdapterLog(filePath, value) {
  fs.writeFileSync(filePath, value || "");
}

function getWorkerOutputPaths(worktreePath, role) {
  const outputRoot = path.join(worktreePath, ".cewp-worker-output");
  return {
    outputRoot,
    reportPath: path.join(outputRoot, `${role}-report.md`),
    eventsPath: path.join(outputRoot, `${role}-events.jsonl`),
  };
}

function copyWorkerOutputToRun({ runRoot, role, localReportPath, localEventsPath }) {
  const reportPath = path.join(runRoot, "reports", `${role}-report.md`);
  const eventPath = path.join(runRoot, "events", `${role}.jsonl`);
  const copied = {
    report: false,
    events: false,
    reportPath,
    eventPath,
  };

  if (fs.existsSync(localReportPath)) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.copyFileSync(localReportPath, reportPath);
    copied.report = true;
  }

  if (fs.existsSync(localEventsPath)) {
    const eventContent = fs.readFileSync(localEventsPath, "utf8");
    if (eventContent.trim().length > 0) {
      fs.mkdirSync(path.dirname(eventPath), { recursive: true });
      fs.appendFileSync(eventPath, eventContent.endsWith("\n") ? eventContent : `${eventContent}\n`);
      copied.events = true;
    }
  }

  return copied;
}

function runCodexExec({ worktreePath, promptPath, outputLastMessagePath, timeoutSeconds, sandbox = "workspace-write" }) {
  const prompt = fs.readFileSync(promptPath, "utf8");
  return childProcess.spawnSync("codex", [
    "exec",
    "--cd",
    worktreePath,
    "--sandbox",
    sandbox,
    "--output-last-message",
    outputLastMessagePath,
    prompt,
  ], {
    cwd: worktreePath,
    encoding: "utf8",
    shell: false,
    timeout: timeoutSeconds * 1000,
    windowsHide: true,
  });
}

function getRepoStatusForReviewer(repoRoot) {
  if (!repoRoot || !fs.existsSync(repoRoot) || !isGitWorktreePath(repoRoot)) {
    return [];
  }

  return getGitStatusShort(repoRoot);
}

function runDispatchReviewerExecActual(options, preflight) {
  const { runId, runRoot, runJson, failures, warnings, preview } = preflight;

  if (failures.length > 0) {
    console.log("CEWP Coordinator Mode codex-exec reviewer execution");
    console.log(`Run ID: ${runId}`);
    console.log("Role: reviewer");
    console.log("Adapter: codex-exec");
    console.log("");
    console.log("Preflight: FAIL");
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    console.log("");
    console.log("No processes were started.");
    console.log("No merge/push/publish was performed.");
    process.exitCode = 1;
    return "FAIL";
  }

  const repoRoot = (runJson && runJson.repoRoot) || process.cwd();
  const repoStatusBefore = getRepoStatusForReviewer(repoRoot);
  const adapterOutputRoot = path.join(runRoot, "adapter-output");
  fs.mkdirSync(adapterOutputRoot, { recursive: true });

  console.log("");
  console.log("Executing codex exec reviewer...");
  const execResult = runCodexExec({
    worktreePath: preview.cwd,
    promptPath: preview.promptPath,
    outputLastMessagePath: preview.outputLastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
    sandbox: "workspace-write",
  });

  const stdoutPath = path.join(adapterOutputRoot, "reviewer-stdout.log");
  const stderrPath = path.join(adapterOutputRoot, "reviewer-stderr.log");
  writeAdapterLog(stdoutPath, execResult.stdout);
  writeAdapterLog(stderrPath, execResult.stderr);

  const reportExists = fs.existsSync(preview.reportPath);
  const lastMessageExists = fs.existsSync(preview.outputLastMessagePath);
  const eventExists = fs.existsSync(preview.eventPath);
  const decision = reportExists ? findReviewerDecisionStrict(preview.reportPath) : undefined;
  const timedOut = Boolean(execResult.error && execResult.error.code === "ETIMEDOUT");
  const exitCode = typeof execResult.status === "number" ? execResult.status : 1;
  const repoStatusAfter = getRepoStatusForReviewer(repoRoot);
  const repoChanged = repoStatusBefore.join("\n") !== repoStatusAfter.join("\n");
  const failuresAfterExec = [];
  const warningsAfterExec = [];

  if (timedOut) {
    failuresAfterExec.push(`codex exec timed out after ${options.timeoutSeconds}s.`);
  }

  if (exitCode !== 0) {
    failuresAfterExec.push(`codex exec exited with code ${exitCode}.`);
  }

  if (!reportExists) {
    failuresAfterExec.push(`reviewer report missing: ${relativeRunPath(runRoot, preview.reportPath)}`);
  } else if (!decision) {
    failuresAfterExec.push("reviewer report does not contain Decision: PASS | REQUEST_CHANGES | BLOCK");
  }

  if (!lastMessageExists) {
    failuresAfterExec.push(`adapter output missing: ${relativeRunPath(runRoot, preview.outputLastMessagePath)}`);
  }

  if (repoChanged) {
    failuresAfterExec.push("public repo git status changed during reviewer execution.");
  }

  if (!eventExists) {
    warningsAfterExec.push(`reviewer event log missing: ${relativeRunPath(runRoot, preview.eventPath)}`);
  }

  const status = failuresAfterExec.length > 0 ? "FAIL" : "PASS";
  appendRunEvent(runRoot, "cli", {
    event: status === "PASS" ? "dispatch_exec_completed" : "dispatch_exec_failed",
    runId,
    adapter: "codex-exec",
    role: "reviewer",
    exitCode,
    status,
    decision: decision || "not_found",
  });

  console.log("");
  console.log("CEWP Coordinator Mode codex-exec reviewer execution");
  console.log(`Run ID: ${runId}`);
  console.log("Role: reviewer");
  console.log("Adapter: codex-exec");
  console.log("");
  console.log(`Preflight: ${warnings.length > 0 ? "WARN" : "PASS"}`);
  console.log(`Execution: ${exitCode === 0 && !timedOut ? "PASS" : "FAIL"}`);
  console.log(`Exit code: ${exitCode}`);
  console.log(`Timeout: ${options.timeoutSeconds}s`);
  console.log(`Decision: ${decision || "not found"}`);
  console.log(`Report: ${reportExists ? `found ${relativeRunPath(runRoot, preview.reportPath)}` : `missing ${relativeRunPath(runRoot, preview.reportPath)}`}`);
  console.log(`Event log: ${eventExists ? relativeRunPath(runRoot, preview.eventPath) : "not provided"}`);
  console.log(`Last message: ${lastMessageExists ? relativeRunPath(runRoot, preview.outputLastMessagePath) : "missing"}`);
  console.log(`Stdout log: ${relativeRunPath(runRoot, stdoutPath)}`);
  console.log(`Stderr log: ${relativeRunPath(runRoot, stderrPath)}`);
  console.log(`Public repo changed: ${repoChanged ? "yes" : "no"}`);
  console.log("");
  console.log(`Status: ${status}`);

  if (failuresAfterExec.length > 0) {
    console.log("Reasons:");
    for (const failure of failuresAfterExec) {
      console.log(`  - ${failure}`);
    }
  }

  if (warningsAfterExec.length > 0) {
    console.log("Warnings:");
    for (const warning of warningsAfterExec) {
      console.log(`  - ${warning}`);
    }
  }

  console.log("");
  console.log("No merge/push/publish was performed.");

  if (status === "FAIL") {
    process.exitCode = 1;
  }

  return status;
}

function runDispatchExecActual(options = {}) {
  if (!options.adapter) {
    throw new Error("dispatch exec requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }

  const result = getDispatchExecPreview({ ...options, dryRun: false, printPreview: false });
  const { runId, runRoot, failures, warnings, preview } = result;

  if (options.role === "reviewer") {
    return runDispatchReviewerExecActual(options, result);
  }

  if (failures.length > 0) {
    console.log("CEWP Coordinator Mode codex-exec execution");
    console.log(`Run ID: ${runId}`);
    console.log(`Role: ${options.role}`);
    console.log("Adapter: codex-exec");
    console.log("");
    console.log("Preflight: FAIL");
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    console.log("");
    console.log("No processes were started.");
    console.log("No merge/push/publish was performed.");
    process.exitCode = 1;
    return "FAIL";
  }

  const adapterOutputRoot = path.join(runRoot, "adapter-output");
  fs.mkdirSync(adapterOutputRoot, { recursive: true });

  console.log("");
  console.log("Executing codex exec...");
  const execResult = runCodexExec({
    worktreePath: preview.cwd,
    promptPath: preview.promptPath,
    outputLastMessagePath: preview.outputLastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
  });

  const stdoutPath = path.join(adapterOutputRoot, `${options.role}-stdout.log`);
  const stderrPath = path.join(adapterOutputRoot, `${options.role}-stderr.log`);
  writeAdapterLog(stdoutPath, execResult.stdout);
  writeAdapterLog(stderrPath, execResult.stderr);

  const workerOutput = getWorkerOutputPaths(preview.cwd, options.role);
  const copiedOutput = copyWorkerOutputToRun({
    runRoot,
    role: options.role,
    localReportPath: workerOutput.reportPath,
    localEventsPath: workerOutput.eventsPath,
  });
  const statusLines = getGitStatusShort(preview.cwd);
  const statusChangedFiles = statusLines.map(parseChangedFile);
  let committedChangedFiles = [];
  let committedDiffError;
  if (preview.worktree.baseCommit) {
    try {
      committedChangedFiles = getCommittedChangedFiles(preview.cwd, preview.worktree.baseCommit);
    } catch (error) {
      committedDiffError = error;
    }
  }
  const changedFiles = uniqueFileList([...statusChangedFiles, ...committedChangedFiles]);
  const runtimeOutputFiles = changedFiles.filter(isWorkerRuntimeOutputPath);
  const scopeWarnings = findScopeWarnings(preview.task.id || "unknown-task", changedFiles, preview.task);
  const forbiddenWarnings = scopeWarnings.filter((warning) => warning.includes("changed forbidden file"));
  const outsideAllowedWarnings = scopeWarnings.filter((warning) => warning.includes("outside allowedFiles"));
  const reportExists = fs.existsSync(preview.reportPath);
  const localReportExists = fs.existsSync(workerOutput.reportPath);
  const localEventsExist = fs.existsSync(workerOutput.eventsPath);
  const lastMessageExists = fs.existsSync(preview.outputLastMessagePath);
  const timedOut = Boolean(execResult.error && execResult.error.code === "ETIMEDOUT");
  const exitCode = typeof execResult.status === "number" ? execResult.status : 1;
  const failuresAfterExec = [];
  const warningsAfterExec = [];

  if (timedOut) {
    failuresAfterExec.push(`codex exec timed out after ${options.timeoutSeconds}s.`);
  }

  if (exitCode !== 0) {
    failuresAfterExec.push(`codex exec exited with code ${exitCode}.`);
  }

  if (!preview.worktree.baseCommit) {
    failuresAfterExec.push("worktree registry missing baseCommit; committed branch scope check could not run.");
  }

  if (committedDiffError) {
    failuresAfterExec.push(committedDiffError.message);
  }

  failuresAfterExec.push(...outsideAllowedWarnings);
  failuresAfterExec.push(...forbiddenWarnings);

  if (!localReportExists) {
    failuresAfterExec.push(`worker output report missing: ${path.relative(preview.cwd, workerOutput.reportPath).replace(/\\/g, "/")}`);
  } else if (!reportExists) {
    failuresAfterExec.push(`report copy missing: ${relativeRunPath(runRoot, preview.reportPath)}`);
  }

  if (!localEventsExist) {
    warningsAfterExec.push(`worker output events missing: ${path.relative(preview.cwd, workerOutput.eventsPath).replace(/\\/g, "/")}`);
  }

  if (!lastMessageExists) {
    failuresAfterExec.push(`adapter output missing: ${relativeRunPath(runRoot, preview.outputLastMessagePath)}`);
  }

  const status = failuresAfterExec.length > 0 ? "FAIL" : "PASS";
  appendRunEvent(runRoot, "cli", {
    event: status === "PASS" ? "dispatch_exec_completed" : "dispatch_exec_failed",
    runId,
    adapter: "codex-exec",
    role: options.role,
    exitCode,
    status,
    taskId: preview.task.id,
    copiedReport: copiedOutput.report,
    copiedEvents: copiedOutput.events,
  });

  console.log("");
  console.log("CEWP Coordinator Mode codex-exec execution");
  console.log(`Run ID: ${runId}`);
  console.log(`Role: ${options.role}`);
  console.log("Adapter: codex-exec");
  console.log("");
  console.log(`Preflight: ${warnings.length > 0 ? "WARN" : "PASS"}`);
  console.log(`Execution: ${exitCode === 0 && !timedOut ? "PASS" : "FAIL"}`);
  console.log(`Exit code: ${exitCode}`);
  console.log(`Timeout: ${options.timeoutSeconds}s`);
  console.log("");
  console.log("Changed files:");
  if (changedFiles.length === 0) {
    console.log("  none");
  } else {
    for (const filePath of changedFiles) {
      console.log(`  ${filePath}${isWorkerRuntimeOutputPath(filePath) ? " (runtime output)" : ""}`);
    }
  }
  console.log("");
  console.log("Committed changes:");
  if (!preview.worktree.baseCommit) {
    console.log("  skipped: worktrees.json entry missing baseCommit");
  } else if (committedDiffError) {
    console.log(`  failed: ${committedDiffError.message}`);
  } else if (committedChangedFiles.length === 0) {
    console.log("  none");
  } else {
    for (const filePath of committedChangedFiles) {
      console.log(`  ${filePath}${isWorkerRuntimeOutputPath(filePath) ? " (runtime output)" : ""}`);
    }
  }
  console.log("");
  console.log("Runtime output:");
  if (runtimeOutputFiles.length === 0) {
    console.log("  none tracked by git status");
  } else {
    for (const filePath of runtimeOutputFiles) {
      console.log(`  ${filePath}`);
    }
  }
  console.log(`Worker report source: ${localReportExists ? path.relative(preview.cwd, workerOutput.reportPath).replace(/\\/g, "/") : "missing"}`);
  console.log(`Worker events source: ${localEventsExist ? path.relative(preview.cwd, workerOutput.eventsPath).replace(/\\/g, "/") : "missing"}`);
  console.log("");
  console.log(`Scope: ${outsideAllowedWarnings.length === 0 ? "OK" : "FAIL"}`);
  console.log(`Forbidden files: ${forbiddenWarnings.length === 0 ? "OK" : "FAIL"}`);
  console.log(`Report: ${reportExists ? `copied to ${relativeRunPath(runRoot, preview.reportPath)}` : `missing ${relativeRunPath(runRoot, preview.reportPath)}`}`);
  console.log(`Worker events: ${copiedOutput.events ? `appended to ${relativeRunPath(runRoot, preview.eventPath)}` : "not provided"}`);
  console.log(`Last message: ${lastMessageExists ? relativeRunPath(runRoot, preview.outputLastMessagePath) : "missing"}`);
  console.log(`Stdout log: ${relativeRunPath(runRoot, stdoutPath)}`);
  console.log(`Stderr log: ${relativeRunPath(runRoot, stderrPath)}`);
  console.log("");
  console.log(`Status: ${status}`);

  if (failuresAfterExec.length > 0) {
    console.log("Reasons:");
    for (const failure of failuresAfterExec) {
      console.log(`  - ${failure}`);
    }
  }

  if (warningsAfterExec.length > 0) {
    console.log("Warnings:");
    for (const warning of warningsAfterExec) {
      console.log(`  - ${warning}`);
    }
  }

  console.log("");
  console.log("No merge/push/publish was performed.");

  if (status === "FAIL") {
    process.exitCode = 1;
  }

  return status;
}

function getParallelWorkersPreflight(options = {}) {
  const roles = ["worker-a", "worker-b"];
  const failures = [];
  const warnings = [];
  const previews = [];

  for (const role of roles) {
    const result = getDispatchExecPreview({
      ...options,
      role,
      dryRun: true,
      printPreview: false,
    });
    previews.push({ role, result });

    for (const failure of result.failures) {
      failures.push(`${role}: ${failure}`);
    }
    for (const warning of result.warnings) {
      warnings.push(`${role}: ${warning}`);
    }
  }

  const workerA = previews.find((entry) => entry.role === "worker-a");
  const workerB = previews.find((entry) => entry.role === "worker-b");
  const previewA = workerA && workerA.result.preview;
  const previewB = workerB && workerB.result.preview;

  if (previewA && previewB) {
    if (previewA.cwd && previewB.cwd && normalizeComparePath(path.resolve(previewA.cwd)) === normalizeComparePath(path.resolve(previewB.cwd))) {
      failures.push(`worker-a and worker-b use the same worktree path: ${previewA.cwd}`);
    }

    const taskIdA = previewA.task && previewA.task.id;
    const taskIdB = previewB.task && previewB.task.id;
    if (taskIdA && taskIdB && taskIdA === taskIdB) {
      failures.push(`worker-a and worker-b are assigned the same task: ${taskIdA}`);
    }

    const allowedA = Array.isArray(previewA.task && previewA.task.allowedFiles) ? previewA.task.allowedFiles : [];
    const allowedB = Array.isArray(previewB.task && previewB.task.allowedFiles) ? previewB.task.allowedFiles : [];
    if (allowedA.length === 0) {
      failures.push("worker-a allowedFiles is empty; parallel execution requires explicit non-overlapping allowedFiles.");
    }
    if (allowedB.length === 0) {
      failures.push("worker-b allowedFiles is empty; parallel execution requires explicit non-overlapping allowedFiles.");
    }

    const overlap = getAllowedFilesOverlap(previewA.task || {}, previewB.task || {});
    if (overlap.length > 0) {
      failures.push(`worker allowedFiles overlap: ${overlap.join(", ")}`);
    }

    const forbiddenA = Array.isArray(previewA.task && previewA.task.forbiddenFiles) ? previewA.task.forbiddenFiles : [];
    const forbiddenB = Array.isArray(previewB.task && previewB.task.forbiddenFiles) ? previewB.task.forbiddenFiles : [];
    if (forbiddenA.length === 0) {
      failures.push("worker-a forbiddenFiles is empty; parallel execution requires forbiddenFiles.");
    }
    if (forbiddenB.length === 0) {
      failures.push("worker-b forbiddenFiles is empty; parallel execution requires forbiddenFiles.");
    }

    if (normalizeComparePath(path.resolve(previewA.reportPath)) === normalizeComparePath(path.resolve(previewB.reportPath))) {
      failures.push(`worker report output paths overlap: ${previewA.reportPath}`);
    }
    if (normalizeComparePath(path.resolve(previewA.eventPath)) === normalizeComparePath(path.resolve(previewB.eventPath))) {
      failures.push(`worker event output paths overlap: ${previewA.eventPath}`);
    }
    if (normalizeComparePath(path.resolve(previewA.outputLastMessagePath)) === normalizeComparePath(path.resolve(previewB.outputLastMessagePath))) {
      failures.push(`adapter output paths overlap: ${previewA.outputLastMessagePath}`);
    }
  }

  return {
    failures,
    warnings,
    previews,
  };
}

function printParallelWorkersPreflight(preflight) {
  console.log(`Parallel preflight: ${preflight.failures.length > 0 ? "FAIL" : preflight.warnings.length > 0 ? "WARN" : "PASS"}`);

  if (preflight.failures.length > 0) {
    console.log("Failures:");
    for (const failure of preflight.failures) {
      console.log(`  - ${failure}`);
    }
  }

  if (preflight.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of preflight.warnings) {
      console.log(`  - ${warning}`);
    }
  }
}

function buildWorkerChildArgs({ role, runId, options }) {
  const args = [
    __filename,
    "run",
    "dispatch",
    "exec",
    role,
    "--run",
    runId,
    "--adapter",
    "codex-exec",
    "--yes",
    "--timeout",
    String(options.timeoutSeconds || 120),
  ];
  return args;
}

function runWorkerChildProcess({ role, runId, options }) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, buildWorkerChildArgs({ role, runId, options }), {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        role,
        status: "FAIL",
        exitCode: 1,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
      });
    });

    child.on("close", (code) => {
      resolve({
        role,
        status: code === 0 ? "PASS" : "FAIL",
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

function runDispatchExecWorkersDryRun(options = {}) {
  const roles = ["worker-a", "worker-b"];
  let hasFailure = false;

  console.log("CEWP Coordinator Mode codex-exec workers dry-run");
  console.log(`Mode: ${options.parallel ? "parallel preview" : "sequential preview"}`);
  console.log("");

  if (options.parallel) {
    const preflight = getParallelWorkersPreflight(options);
    printParallelWorkersPreflight(preflight);
    if (preflight.failures.length > 0) {
      hasFailure = true;
    }
    console.log("");
  }

  console.log("Worker order:");
  console.log("  1. worker-a");
  console.log("  2. worker-b");
  console.log("");

  for (const role of roles) {
    const result = getDispatchExecPreview({ ...options, role, dryRun: true });
    if (result.failures.length > 0) {
      hasFailure = true;
    }
    console.log("");
  }

  console.log("No processes were started.");
  console.log("No files were changed.");

  if (hasFailure) {
    process.exitCode = 1;
  }

  return hasFailure ? "FAIL" : "PASS";
}

async function runDispatchExecWorkersParallelActual(options = {}) {
  if (!options.adapter) {
    throw new Error("dispatch exec requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }

  const { runId } = findRun(options);
  const preflight = getParallelWorkersPreflight(options);

  console.log("CEWP Coordinator Mode codex-exec workers execution");
  console.log(`Run ID: ${runId}`);
  console.log("Adapter: codex-exec");
  console.log("Mode: parallel");
  console.log("");
  printParallelWorkersPreflight(preflight);
  console.log("");

  if (preflight.failures.length > 0) {
    console.log("No worker processes were started.");
    console.log("No reviewer execution, merge, push, or publish was performed.");
    process.exitCode = 1;
    return {
      overall: "FAIL",
      results: [
        { role: "worker-a", status: "SKIPPED" },
        { role: "worker-b", status: "SKIPPED" },
      ],
    };
  }

  console.log("Worker mode:");
  console.log("  worker-a and worker-b start concurrently.");
  console.log("  Parallel mode is not fail-fast; both workers may finish even if one fails.");
  console.log("");

  const childResults = await Promise.all([
    runWorkerChildProcess({ role: "worker-a", runId, options }),
    runWorkerChildProcess({ role: "worker-b", runId, options }),
  ]);

  for (const result of childResults) {
    console.log(`--- ${result.role} output ---`);
    if (result.stdout.trim().length > 0) {
      process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
    }
    if (result.stderr.trim().length > 0) {
      process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
    }
  }

  const results = childResults.map((result) => ({ role: result.role, status: result.status }));
  const overall = results.every((result) => result.status === "PASS") ? "PASS" : "FAIL";

  console.log("");
  console.log("CEWP Coordinator Mode codex-exec workers summary");
  for (const result of results) {
    console.log(`${result.role}: ${result.status}`);
  }
  console.log("");
  console.log(`Overall: ${overall}`);

  if (overall === "PASS") {
    console.log("");
    console.log("Next:");
    console.log(`  cewp run collect --run ${runId}`);
    console.log(`  cewp run dispatch exec reviewer --run ${runId} --adapter codex-exec --yes`);
  } else {
    console.log("Reason: one or more parallel workers failed post-check");
    process.exitCode = 1;
  }

  console.log("");
  console.log("No reviewer execution, merge, push, or publish was performed.");

  return {
    overall,
    results,
  };
}

async function runDispatchExecWorkersActual(options = {}) {
  if (options.parallel) {
    return runDispatchExecWorkersParallelActual(options);
  }

  if (!options.adapter) {
    throw new Error("dispatch exec requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }

  const { runId } = findRun(options);
  const results = [];
  let overall = "PASS";

  console.log("CEWP Coordinator Mode codex-exec workers execution");
  console.log(`Run ID: ${runId}`);
  console.log("Adapter: codex-exec");
  console.log("Mode: sequential");
  console.log("");
  console.log("Worker order:");
  console.log("  1. worker-a");
  console.log("  2. worker-b");
  console.log("");

  for (const role of ["worker-a", "worker-b"]) {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const status = runDispatchExecActual({ ...options, role, yes: true, dryRun: false });
    results.push({ role, status: status || "FAIL" });

    if (status !== "PASS") {
      process.exitCode = 1;
      if (role === "worker-a") {
        results.push({ role: "worker-b", status: "SKIPPED" });
      }
      if (previousExitCode) {
        process.exitCode = previousExitCode;
      }
      overall = "FAIL";
      break;
    }
  }

  overall = results.some((result) => result.status === "FAIL") ? "FAIL" : overall;

  console.log("");
  console.log("CEWP Coordinator Mode codex-exec workers summary");
  for (const result of results) {
    console.log(`${result.role}: ${result.status}`);
  }
  console.log("");
  console.log(`Overall: ${overall}`);

  if (overall === "PASS") {
    console.log("");
    console.log("Next:");
    console.log(`  cewp run collect --run ${runId}`);
    console.log(`  cewp run dispatch exec reviewer --run ${runId} --adapter codex-exec --yes`);
  } else {
    const failed = results.find((result) => result.status === "FAIL");
    console.log(`Reason: ${failed ? `${failed.role} failed post-check` : "worker execution failed"}`);
    process.exitCode = 1;
  }

  console.log("");
  console.log("No reviewer execution, merge, push, or publish was performed.");

  return {
    overall,
    results,
  };
}

async function runDispatchExec(options = {}) {
  if (options.dryRun && options.yes) {
    throw new Error("Use either --dry-run or --yes, not both.");
  }

  if (!options.dryRun && !options.yes) {
    throw new Error("dispatch exec requires --dry-run or --yes.");
  }

  if (options.parallel && options.role !== "workers") {
    throw new Error("--parallel is only supported with dispatch exec workers.");
  }

  if (options.role === "workers") {
    if (options.dryRun) {
      runDispatchExecWorkersDryRun(options);
      return;
    }

    await runDispatchExecWorkersActual(options);
    return;
  }

  if (options.dryRun) {
    const result = getDispatchExecPreview(options);
    if (result.failures.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  runDispatchExecActual(options);
}

function validateCodexExecAdapter(options) {
  if (!options.adapter) {
    throw new Error("dispatch pipeline requires --adapter codex-exec.");
  }

  if (options.adapter !== "codex-exec") {
    throw new Error(`Unsupported dispatch adapter: ${options.adapter}. Supported adapter: codex-exec.`);
  }
}

function runDispatchPipelineDryRun(options = {}) {
  validateCodexExecAdapter(options);

  const { runId, runRoot } = findRun(options);
  const dispatchPromptsRoot = path.join(runRoot, "dispatch-prompts");
  const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
  const promptCheckOptions = fs.existsSync(dispatchPromptsRoot)
    ? options
    : { ...options, ignoreMissingDispatchPrompts: true };

  console.log("CEWP Coordinator Mode dispatch pipeline");
  console.log(`Run ID: ${runId}`);
  console.log("Adapter: codex-exec");
  console.log(`Mode: dry-run ${options.parallel ? "parallel" : "sequential"} preview`);
  console.log("");

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const checkStatus = runDispatchCheck(promptCheckOptions);
  const checkFailed = process.exitCode === 1 || checkStatus === "FAIL";
  process.exitCode = previousExitCode;
  console.log("");

  console.log("Pipeline preview:");
  console.log(`  Step 1 dispatch check: ${checkStatus || "UNKNOWN"}`);
  console.log(`  Step 2 dispatch prompts: ${fs.existsSync(dispatchPromptsRoot) ? "would refresh existing prompt bundles" : "would create prompt bundles"}`);
  console.log(`  Step 3 workers: ${options.parallel ? "parallel" : "sequential"} preview follows`);
  const previewOptions = {
    ...options,
    ignoreMissingDispatchPrompts: true,
    ignoreMissingReviewInputs: true,
  };
  const workersPreviewStatus = runDispatchExecWorkersDryRun({ ...previewOptions, dryRun: true, role: "workers" });
  console.log(`  Step 4 collect: would write ${relativeRunPath(runRoot, reviewPacketPath)}`);
  console.log("  Step 5 reviewer: preview follows");
  const reviewerPreview = getDispatchExecPreview({ ...previewOptions, role: "reviewer", dryRun: true });
  console.log("");
  console.log("Overall dry-run:");
  console.log(checkFailed || workersPreviewStatus === "FAIL" || reviewerPreview.failures.length > 0 ? "  FAIL" : "  PASS");
  console.log("");
  console.log("No processes were started.");
  console.log("No files were changed.");

  if (checkFailed || workersPreviewStatus === "FAIL" || reviewerPreview.failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runDispatchPipelineActual(options = {}) {
  validateCodexExecAdapter(options);

  const { runId, runRoot } = findRun(options);
  const steps = [];
  let decision = "not found";
  let packetPath;
  const dispatchPromptsRoot = path.join(runRoot, "dispatch-prompts");
  const promptCheckOptions = fs.existsSync(dispatchPromptsRoot)
    ? options
    : { ...options, ignoreMissingDispatchPrompts: true };

  console.log("CEWP Coordinator Mode dispatch pipeline");
  console.log(`Run ID: ${runId}`);
  console.log("Adapter: codex-exec");
  console.log(`Mode: ${options.parallel ? "parallel" : "sequential"}`);
  console.log("");

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const checkStatus = runDispatchCheck(promptCheckOptions);
  const checkFailed = process.exitCode === 1 || checkStatus === "FAIL";
  process.exitCode = previousExitCode;
  steps.push({ name: "dispatch check", status: checkFailed ? "FAIL" : checkStatus });
  if (checkFailed) {
    printDispatchPipelineSummary({ runId, steps, decision, overall: "FAIL", reason: "dispatch check failed" });
    process.exitCode = 1;
    return;
  }

  let promptsResult;
  try {
    promptsResult = runDispatchPrompts(options);
    steps.push({ name: "dispatch prompts", status: "PASS" });
  } catch (error) {
    steps.push({ name: "dispatch prompts", status: "FAIL" });
    printDispatchPipelineSummary({ runId, steps, decision, overall: "FAIL", reason: error.message });
    process.exitCode = 1;
    return;
  }

  const workersResult = await runDispatchExecWorkersActual(options);
  steps.push({ name: "workers", status: workersResult.overall, details: workersResult.results });
  if (workersResult.overall !== "PASS") {
    printDispatchPipelineSummary({ runId, steps, decision, overall: "FAIL", reason: "workers failed" });
    process.exitCode = 1;
    return;
  }

  let collectResult;
  try {
    collectResult = runCollect(options);
    packetPath = collectResult.packetPath;
    steps.push({ name: "collect", status: "PASS" });
  } catch (error) {
    steps.push({ name: "collect", status: "FAIL" });
    printDispatchPipelineSummary({ runId, steps, decision, overall: "FAIL", reason: error.message });
    process.exitCode = 1;
    return;
  }

  const reviewerStatus = runDispatchReviewerExecActual(options, getDispatchExecPreview({ ...options, role: "reviewer", printPreview: false }));
  steps.push({ name: "reviewer", status: reviewerStatus });
  try {
    decision = findReviewerDecisionStrict(path.join(findRun(options).runRoot, "reviews", "reviewer-report.md")) || "not found";
  } catch {
    decision = "not found";
  }

  const overall = reviewerStatus === "PASS" ? "PASS" : "FAIL";
  printDispatchPipelineSummary({ runId, steps, decision, overall, packetPath });

  if (overall !== "PASS") {
    process.exitCode = 1;
  }
}

function printDispatchPipelineSummary({ runId, steps, decision, overall, reason, packetPath }) {
  console.log("");
  console.log("CEWP Coordinator Mode dispatch pipeline summary");
  steps.forEach((step, index) => {
    console.log(`Step ${index + 1}/${steps.length} ${step.name}: ${step.status}`);
    if (step.details) {
      for (const detail of step.details) {
        console.log(`  ${detail.role}: ${detail.status}`);
      }
    }
  });

  if (packetPath) {
    console.log(`Review packet: ${packetPath}`);
  }

  if (decision && decision !== "not found") {
    console.log(`Reviewer decision: ${decision}`);
  }

  console.log("");
  console.log(`Overall: ${overall}`);
  if (reason) {
    console.log(`Reason: ${reason}`);
  }

  if (overall === "PASS") {
    console.log("");
    console.log("Next:");
    console.log(`  cewp run finalize --run ${runId} --dry-run`);
    console.log(`  cewp run finalize --run ${runId}`);
  }

  console.log("");
  console.log("No finalize, cleanup, merge, push, or publish was performed.");
}

async function runDispatchPipeline(options = {}) {
  if (options.dryRun && options.yes) {
    throw new Error("Use either --dry-run or --yes, not both.");
  }

  if (!options.dryRun && !options.yes) {
    throw new Error("dispatch pipeline requires --dry-run or --yes.");
  }

  if (options.dryRun) {
    runDispatchPipelineDryRun(options);
    return;
  }

  await runDispatchPipelineActual(options);
}

function readWorktreesRegistry(runRoot) {
  const registryPath = path.join(runRoot, "worktrees.json");

  if (!fs.existsSync(registryPath)) {
    return undefined;
  }

  const registry = readJsonFile(registryPath, "worktrees registry");

  if (!Array.isArray(registry.worktrees)) {
    throw new Error(`Invalid worktrees registry: ${registryPath}. Missing worktrees array.`);
  }

  return registry;
}

function getTaskMap(runRoot) {
  return new Map(readTasks(runRoot).map(({ task }) => [task.id, task]));
}

function findReviewerDecisionStrict(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^\s*Decision\s*:\s*(PASS|REQUEST_CHANGES|BLOCK)\b/im);
  return match ? match[1] : undefined;
}
async function runCommand(options) {
  if (options.help || !options.subcommand) {
    usage();
    return;
  }

  if (options.subcommand === "init") {
    runInit(options);
    return;
  }

  if (options.subcommand === "status") {
    runStatus(options);
    return;
  }

  if (options.subcommand === "prompts") {
    runPrompts(options);
    return;
  }

  if (options.subcommand === "prompt") {
    runPrompt(options.role, options);
    return;
  }

  if (options.subcommand === "collect") {
    runCollect(options);
    return;
  }

  if (options.subcommand === "finalize") {
    runFinalize(options);
    return;
  }

  if (options.subcommand === "cleanup") {
    runCleanup(options);
    return;
  }

  if (options.subcommand === "prune") {
    runPrune(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "plan") {
    runWorktreesPlan(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "create") {
    runWorktreesCreate(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "status") {
    runWorktreesStatus(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "plan") {
    runDispatchPlan(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "check") {
    runDispatchCheck(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "prompts") {
    runDispatchPrompts(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "start") {
    runDispatchStart(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "exec") {
    await runDispatchExec(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "pipeline") {
    await runDispatchPipeline(options);
    return;
  }

  throw new Error(`Unsupported run command: ${options.subcommand}`);
}

async function main() {
  const rawArgs = process.argv.slice(2);

  try {
    const args = parseArgs(rawArgs);

    if (!args.command || args.help) {
      usage();
      return;
    }

    if (args.command === "init") {
      init(args);
      return;
    }

    if (args.command === "list") {
      list(args);
      return;
    }

    if (args.command === "doctor") {
      doctor(args);
      return;
    }

    if (args.command === "run") {
      await runCommand(args);
      return;
    }

    if (!["init", "list", "doctor", "run"].includes(args.command)) {
      throw new Error(`Unsupported command: ${args.command}`);
    }
  } catch (error) {
    printCliError(error, rawArgs);
    process.exitCode = 1;
  }
}

main();
