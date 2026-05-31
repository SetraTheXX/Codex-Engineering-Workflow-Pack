#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { listFiles } = require("../src/lib/fs");
const { getRunsRoot, validateRunId, normalizeComparePath } = require("../src/lib/paths");
const { getAllowedFilesOverlap } = require("../src/lib/scope-check");
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
const { relativeRunPath } = require("../src/run/dispatch/shared");
const {
  getDispatchExecPreview,
  runDispatchReviewerExecActual,
  runDispatchExecActual,
  runDispatchExec: runSingleDispatchExec,
} = require("../src/run/dispatch/exec");
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

  if (options.role === "workers") {
    if (options.dryRun) {
      runDispatchExecWorkersDryRun(options);
      return;
    }

    await runDispatchExecWorkersActual(options);
    return;
  }

  await runSingleDispatchExec(options);
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
