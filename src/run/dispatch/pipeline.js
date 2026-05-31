"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findRun } = require("../runtime-cleanup");
const { runCollect } = require("../collect");
const { assertPolicyAllows } = require("../policy");
const { runDispatchCheck } = require("./check");
const { runDispatchPrompts } = require("./prompts");
const { relativeRunPath } = require("./shared");
const { getDispatchExecPreview, runDispatchReviewerExecActual } = require("./exec");
const { runDispatchExecWorkersDryRun, runDispatchExecWorkersActual } = require("./workers");

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
  assertPolicyAllows(process.cwd(), "runCewpPipeline");
  assertPolicyAllows(process.cwd(), "runWorkers");
  assertPolicyAllows(process.cwd(), "runReviewer");

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

function findReviewerDecisionStrict(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^\s*Decision\s*:\s*(PASS|REQUEST_CHANGES|BLOCK)\b/im);
  return match ? match[1] : undefined;
}

module.exports = {
  runDispatchPipeline,
};
