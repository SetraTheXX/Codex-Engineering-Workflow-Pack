"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonIfExists } = require("../../lib/json");
const { listFiles } = require("../../lib/fs");
const {
  isGitWorktreePath,
  getGitStatusShort,
  getCommittedChangedFiles,
} = require("../../lib/git");
const {
  parseChangedFile,
  uniqueFileList,
  isWorkerRuntimeOutputPath,
  findScopeWarnings,
} = require("../../lib/scope-check");
const { findRun, readWorktreesRegistry, appendRunEvent } = require("../runtime-cleanup");
const {
  relativeRunPath,
  readTasks,
  getDispatchWorktree,
  getWorkerTaskForRole,
  getDispatchPromptPathForTask,
} = require("./shared");
const { getAdapter } = require("../adapters/registry");
const { resolveAdapterConfigForRole, resolveAdapterProviderForRole } = require("../adapters/config");
const { assertPolicyAllows } = require("../policy");

function findReviewerDecisionStrict(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^\s*Decision\s*:\s*(PASS|REQUEST_CHANGES|BLOCK)\b/im);
  return match ? match[1] : undefined;
}

function getAdapterExecutionName(adapter) {
  return adapter.executionName || "codex exec";
}

function checkAdapterAvailability(adapter) {
  if (adapter.checkAdapterAvailability) {
    return adapter.checkAdapterAvailability();
  }
  return adapter.checkCodexExecAvailability();
}

function runDispatchAdapter(adapter, args) {
  if (adapter.runDispatchAdapter) {
    return adapter.runDispatchAdapter(args);
  }
  return adapter.runCodexExecAdapter(args);
}

function formatAdapterExitReason(adapter, exitCode, execResult) {
  if (adapter.formatExitReason) {
    return adapter.formatExitReason(exitCode, execResult);
  }
  return `codex exec exited with code ${exitCode}.`;
}

function getDispatchExecPreview(options) {
  const supportedRoles = ["worker-a", "worker-b", "reviewer"];
  const shouldPrint = options.printPreview !== false;

  if (!supportedRoles.includes(options.role)) {
    throw new Error(`Unsupported dispatch exec role: ${options.role || "(missing)"}. Supported roles: worker-a, worker-b, reviewer.`);
  }

  const adapterConfig = resolveAdapterConfigForRole({
    role: options.role,
    adapterName: options.adapter,
    commandName: "dispatch exec",
    requireAdapter: true,
  });
  const adapterName = adapterConfig.provider;
  const adapter = getAdapter(adapterName, { commandName: "dispatch exec" });

  const { runId, runRoot } = findRun(options);
  const runJson = readJsonIfExists(path.join(runRoot, "run.json"));
  const boardJson = readJsonIfExists(path.join(runRoot, "board.json"));
  const taskEntries = readTasks(runRoot);
  const worktreesRegistry = readWorktreesRegistry(runRoot);
  const dispatchPromptsRoot = path.join(runRoot, "dispatch-prompts");
  const { outputLastMessagePath } = adapter.getAdapterOutputPaths(runRoot, options.role);
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

    if (!Array.isArray(task.allowedFiles) || task.allowedFiles.length === 0) {
      const message = `task ${taskId} has no allowedFiles; real worker execution requires an explicit file scope.`;
      if (options.dryRun) {
        warnings.push(message);
      } else {
        failures.push(message);
      }
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

  if (preview) {
    preview.model = adapterConfig.model || null;
  }

  if (shouldPrint) {
    console.log(`CEWP Coordinator Mode ${adapterName} adapter dry-run`);
    console.log(`Run ID: ${runId}`);
    console.log(`Role: ${options.role}`);
    console.log(`Adapter: ${adapterName}`);
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
        const workerOutput = adapter.getWorkerOutputPaths(preview.cwd, preview.role);
        console.log(`  Worker report source: ${path.relative(preview.cwd, workerOutput.reportPath).replace(/\\/g, "/")}`);
        console.log(`  Worker events source: ${path.relative(preview.cwd, workerOutput.eventsPath).replace(/\\/g, "/")}`);
      }
      console.log(`  Report: ${relativeRunPath(runRoot, preview.reportPath)}`);
      console.log(`  Event log: ${relativeRunPath(runRoot, preview.eventPath)}`);
      console.log(`  Last message: ${relativeRunPath(runRoot, preview.outputLastMessagePath)}`);
      console.log("");
      console.log("Recommended execution strategy:");
      console.log(`  Use the ${adapterName} adapter with the dispatch prompt file.`);
      console.log("  Do not inline the full prompt in a shell command.");
      console.log("");
      adapter.printCodexExecPreview({
        runRoot,
        role: preview.role,
        cwd: preview.cwd || "<missing-workdir>",
        promptPath: preview.promptPath,
        outputPath: preview.outputLastMessagePath,
        sandbox: preview.sandbox,
        model: preview.model,
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

function getRepoStatusForReviewer(repoRoot) {
  if (!repoRoot || !fs.existsSync(repoRoot) || !isGitWorktreePath(repoRoot)) {
    return [];
  }

  return getGitStatusShort(repoRoot);
}

function runDispatchReviewerExecActual(options, preflight) {
  const adapterName = resolveAdapterProviderForRole({
    role: "reviewer",
    adapterName: options.adapter,
    commandName: "dispatch exec",
    requireAdapter: true,
  });
  const adapter = getAdapter(adapterName, { commandName: "dispatch exec" });
  const { runId, runRoot, runJson, failures, warnings, preview } = preflight;

  if (failures.length > 0) {
    console.log("CEWP Coordinator Mode reviewer execution");
    console.log(`Run ID: ${runId}`);
    console.log("Role: reviewer");
    console.log(`Adapter: ${adapterName}`);
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
    return adapter.normalizeAdapterResult({
      role: "reviewer",
      status: "FAIL",
      reasons: failures,
      runRoot,
      paths: {
        report: preview && preview.reportPath,
        event: preview && preview.eventPath,
        lastMessage: preview && preview.outputLastMessagePath,
      },
    });
  }

  const availability = checkAdapterAvailability(adapter);
  if (availability.status !== "PASS") {
    const reason = `adapter availability failed: ${availability.reason}`;
    console.log("CEWP Coordinator Mode reviewer execution");
    console.log(`Run ID: ${runId}`);
    console.log("Role: reviewer");
    console.log(`Adapter: ${adapterName}`);
    console.log("");
    console.log("Preflight: FAIL");
    console.log("Failures:");
    console.log(`  - ${reason}`);
    console.log("");
    console.log("No processes were started.");
    console.log("No merge/push/publish was performed.");
    process.exitCode = 1;
    return adapter.normalizeAdapterResult({
      role: "reviewer",
      status: "FAIL",
      reason,
      reasons: [reason],
      runRoot,
      paths: {
        report: preview && preview.reportPath,
        event: preview && preview.eventPath,
        lastMessage: preview && preview.outputLastMessagePath,
      },
    });
  }

  const repoRoot = (runJson && runJson.repoRoot) || process.cwd();
  const repoStatusBefore = getRepoStatusForReviewer(repoRoot);
  const { adapterOutputRoot, stdoutPath, stderrPath } = adapter.getAdapterOutputPaths(runRoot, "reviewer");
  fs.mkdirSync(adapterOutputRoot, { recursive: true });

  console.log("");
  console.log(`Executing ${getAdapterExecutionName(adapter)} reviewer...`);
  const execResult = runDispatchAdapter(adapter, {
    runRoot,
    role: "reviewer",
    worktreePath: preview.cwd,
    promptPath: preview.promptPath,
    outputLastMessagePath: preview.outputLastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
    sandbox: "workspace-write",
    model: preview.model,
  });

  adapter.writeAdapterLog(stdoutPath, execResult.stdout);
  adapter.writeAdapterLog(stderrPath, execResult.stderr);

  const reportExists = fs.existsSync(preview.reportPath);
  const lastMessageExists = fs.existsSync(preview.outputLastMessagePath);
  const eventExists = fs.existsSync(preview.eventPath);
  const decision = reportExists ? findReviewerDecisionStrict(preview.reportPath) : undefined;
  const timedOut = adapter.didAdapterTimeOut(execResult);
  const exitCode = adapter.getAdapterExitCode(execResult);
  const repoStatusAfter = getRepoStatusForReviewer(repoRoot);
  const repoChanged = repoStatusBefore.join("\n") !== repoStatusAfter.join("\n");
  const failuresAfterExec = [];
  const warningsAfterExec = [];

  if (timedOut) {
    failuresAfterExec.push(`${getAdapterExecutionName(adapter)} timed out after ${options.timeoutSeconds}s.`);
  }

  if (exitCode !== 0) {
    failuresAfterExec.push(formatAdapterExitReason(adapter, exitCode, execResult));
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
    adapter: adapterName,
    role: "reviewer",
    exitCode,
    status,
    decision: decision || "not_found",
  });

  console.log("");
  console.log("CEWP Coordinator Mode reviewer execution");
  console.log(`Run ID: ${runId}`);
  console.log("Role: reviewer");
  console.log(`Adapter: ${adapterName}`);
  console.log("");
  console.log(`Preflight: ${warnings.length > 0 ? "WARN" : "PASS"}`);
  console.log(`Execution: ${exitCode === 0 && !timedOut ? "PASS" : "FAIL"}`);
  console.log(`Exit code: ${exitCode}`);
  console.log(`Timeout: ${options.timeoutSeconds}s`);
  console.log(`Decision: ${decision || "not found"}`);
  console.log(`Report: ${reportExists ? `found ${relativeRunPath(runRoot, preview.reportPath)}` : `missing ${relativeRunPath(runRoot, preview.reportPath)}`}`);
  console.log(`Event log: ${eventExists ? relativeRunPath(runRoot, preview.eventPath) : "not provided"}`);
  console.log(`Last message: ${lastMessageExists ? relativeRunPath(runRoot, preview.outputLastMessagePath) : "missing"}`);
  if (execResult.manualPath) {
    console.log(`Manual handoff: ${relativeRunPath(runRoot, execResult.manualPath)}`);
  }
  if (execResult.externalCommandExecuted === false) {
    console.log("External command: not executed");
  }
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

  return adapter.normalizeAdapterResult({
    role: "reviewer",
    status,
    exitCode,
    timedOut,
    reason: failuresAfterExec[0],
    reasons: failuresAfterExec,
    decision: decision || "not_found",
    runRoot,
    paths: {
      stdout: stdoutPath,
      stderr: stderrPath,
      report: preview.reportPath,
      event: preview.eventPath,
      lastMessage: preview.outputLastMessagePath,
      handoff: execResult.manualPath,
    },
  });
}

function runDispatchExecActual(options = {}) {
  const adapterName = resolveAdapterProviderForRole({
    role: options.role,
    adapterName: options.adapter,
    commandName: "dispatch exec",
    requireAdapter: true,
  });
  const adapter = getAdapter(adapterName, { commandName: "dispatch exec" });

  if (options.role === "reviewer") {
    assertPolicyAllows(process.cwd(), "runReviewer");
  } else {
    assertPolicyAllows(process.cwd(), "runWorkers");
  }

  const result = getDispatchExecPreview({ ...options, dryRun: false, printPreview: false });
  const { runId, runRoot, failures, warnings, preview } = result;

  if (options.role === "reviewer") {
    return runDispatchReviewerExecActual(options, result);
  }

  if (failures.length > 0) {
    console.log("CEWP Coordinator Mode execution");
    console.log(`Run ID: ${runId}`);
    console.log(`Role: ${options.role}`);
    console.log(`Adapter: ${adapterName}`);
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
    return adapter.normalizeAdapterResult({
      role: options.role,
      status: "FAIL",
      reasons: failures,
      runRoot,
      paths: {
        report: preview && preview.reportPath,
        event: preview && preview.eventPath,
        lastMessage: preview && preview.outputLastMessagePath,
      },
    });
  }

  const availability = checkAdapterAvailability(adapter);
  if (availability.status !== "PASS") {
    const reason = `adapter availability failed: ${availability.reason}`;
    console.log("CEWP Coordinator Mode execution");
    console.log(`Run ID: ${runId}`);
    console.log(`Role: ${options.role}`);
    console.log(`Adapter: ${adapterName}`);
    console.log("");
    console.log("Preflight: FAIL");
    console.log("Failures:");
    console.log(`  - ${reason}`);
    console.log("");
    console.log("No processes were started.");
    console.log("No merge/push/publish was performed.");
    process.exitCode = 1;
    return adapter.normalizeAdapterResult({
      role: options.role,
      status: "FAIL",
      reason,
      reasons: [reason],
      runRoot,
      paths: {
        report: preview && preview.reportPath,
        event: preview && preview.eventPath,
        lastMessage: preview && preview.outputLastMessagePath,
      },
    });
  }

  const { adapterOutputRoot, stdoutPath, stderrPath } = adapter.getAdapterOutputPaths(runRoot, options.role);
  fs.mkdirSync(adapterOutputRoot, { recursive: true });

  console.log("");
  console.log(`Executing ${getAdapterExecutionName(adapter)}...`);
  const execResult = runDispatchAdapter(adapter, {
    runRoot,
    role: options.role,
    worktreePath: preview.cwd,
    promptPath: preview.promptPath,
    outputLastMessagePath: preview.outputLastMessagePath,
    timeoutSeconds: options.timeoutSeconds,
    model: preview.model,
  });

  adapter.writeAdapterLog(stdoutPath, execResult.stdout);
  adapter.writeAdapterLog(stderrPath, execResult.stderr);

  const workerOutput = adapter.getWorkerOutputPaths(preview.cwd, options.role);
  const copiedOutput = adapter.copyWorkerOutputToRun({
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
  const timedOut = adapter.didAdapterTimeOut(execResult);
  const exitCode = adapter.getAdapterExitCode(execResult);
  const failuresAfterExec = [];
  const warningsAfterExec = [];

  if (timedOut) {
    failuresAfterExec.push(`${getAdapterExecutionName(adapter)} timed out after ${options.timeoutSeconds}s.`);
  }

  if (exitCode !== 0) {
    failuresAfterExec.push(formatAdapterExitReason(adapter, exitCode, execResult));
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
    adapter: adapterName,
    role: options.role,
    exitCode,
    status,
    taskId: preview.task.id,
    copiedReport: copiedOutput.report,
    copiedEvents: copiedOutput.events,
  });

  console.log("");
  console.log("CEWP Coordinator Mode execution");
  console.log(`Run ID: ${runId}`);
  console.log(`Role: ${options.role}`);
  console.log(`Adapter: ${adapterName}`);
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
  if (execResult.manualPath) {
    console.log(`Manual handoff: ${relativeRunPath(runRoot, execResult.manualPath)}`);
  }
  if (execResult.externalCommandExecuted === false) {
    console.log("External command: not executed");
  }
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

  return adapter.normalizeAdapterResult({
    role: options.role,
    status,
    exitCode,
    timedOut,
    reason: failuresAfterExec[0],
    reasons: failuresAfterExec,
    runRoot,
    paths: {
      stdout: stdoutPath,
      stderr: stderrPath,
      report: preview.reportPath,
      event: preview.eventPath,
      lastMessage: preview.outputLastMessagePath,
      handoff: execResult.manualPath,
      workerReport: workerOutput.reportPath,
      workerEvents: workerOutput.eventsPath,
    },
  });
}

async function runDispatchExec(options = {}) {
  if (options.dryRun && options.yes) {
    throw new Error("Use either --dry-run or --yes, not both.");
  }

  if (!options.dryRun && !options.yes) {
    throw new Error("dispatch exec requires --dry-run or --yes.");
  }

  if (options.parallel) {
    throw new Error("--parallel is only supported with dispatch exec workers.");
  }

  if (options.role === "workers") {
    throw new Error("dispatch exec workers is handled by the workers orchestration command.");
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

module.exports = {
  getDispatchExecPreview,
  runDispatchReviewerExecActual,
  runDispatchExecActual,
  runDispatchExec,
};
