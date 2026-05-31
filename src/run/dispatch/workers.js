"use strict";

const path = require("node:path");
const childProcess = require("node:child_process");
const { normalizeComparePath } = require("../../lib/paths");
const { getAllowedFilesOverlap } = require("../../lib/scope-check");
const { findRun } = require("../runtime-cleanup");
const { assertPolicyAllows } = require("../policy");
const { getDispatchExecPreview, runDispatchExecActual } = require("./exec");

const CLI_ENTRYPOINT = path.resolve(__dirname, "../../../bin/cewp.js");

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
    CLI_ENTRYPOINT,
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

  assertPolicyAllows(process.cwd(), "runWorkers");

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

  assertPolicyAllows(process.cwd(), "runWorkers");

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

async function runDispatchWorkers(options = {}) {
  if (options.dryRun && options.yes) {
    throw new Error("Use either --dry-run or --yes, not both.");
  }

  if (!options.dryRun && !options.yes) {
    throw new Error("dispatch exec requires --dry-run or --yes.");
  }

  if (options.dryRun) {
    runDispatchExecWorkersDryRun(options);
    return;
  }

  await runDispatchExecWorkersActual(options);
}

module.exports = {
  getParallelWorkersPreflight,
  runDispatchExecWorkersDryRun,
  runDispatchExecWorkersActual,
  runDispatchWorkers,
};
