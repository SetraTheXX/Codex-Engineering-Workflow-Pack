"use strict";

const path = require("node:path");
const { relativeRunPath } = require("../dispatch/shared");

function markdownArray(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "- none";
  }

  return value.map((item) => `- ${item}`).join("\n");
}

function createWorkerDispatchPrompt({ runId, runRoot, runJson, task, worktree }) {
  const assignedRole = task.assignedRole || "unassigned";
  const reportPath = path.join(runRoot, "reports", `${assignedRole}-report.md`);
  const eventPath = path.join(runRoot, "events", `${assignedRole}.jsonl`);
  const workerOutputReport = `.cewp-worker-output/${assignedRole}-report.md`;
  const workerOutputEvents = `.cewp-worker-output/${assignedRole}-events.jsonl`;

  return `# CEWP Dispatch Prompt - Worker

Role: ${assignedRole}
Task: ${task.id}
Run ID: ${runId}
Repo root: ${(runJson && runJson.repoRoot) || process.cwd()}
Run root: ${runRoot}
Worktree path: ${worktree.path}
Branch: ${worktree.branch || task.branch || "unknown"}

## Mission
${task.mission || "Complete the assigned task exactly as described in the task metadata."}

## Task Metadata
- title: ${task.title || "(untitled)"}
- status: ${task.status || "unknown"}
- assignedRole: ${assignedRole}
- dependsOn: ${Array.isArray(task.dependsOn) && task.dependsOn.length ? task.dependsOn.join(", ") : "none"}
- allowedFiles:
${markdownArray(task.allowedFiles)}
- forbiddenFiles:
${markdownArray(task.forbiddenFiles)}
- verification:
${markdownArray(task.verification)}

## Hard Rules
- Work only inside the assigned worktree.
- Do not write board.json.
- Do not edit tasks/*.json.
- Do not edit files outside allowedFiles when allowedFiles is non-empty.
- Do not touch forbiddenFiles.
- Do not merge.
- Do not push.
- Do not publish.
- Do not spawn Codex processes.
- Do not automate terminal input.

## Required Outputs
Write inside your assigned worktree:
- ${workerOutputReport}
- ${workerOutputEvents}

Do not write directly to:
- ${relativeRunPath(runRoot, reportPath)}
- ${relativeRunPath(runRoot, eventPath)}

The CLI will copy worker output into the run directory after execution.

## Report Template
\`\`\`md
# Worker Report

Role: ${assignedRole}
Task: ${task.id}
Status: ready_for_review | blocked

## Summary

## Changed Files

## Commands Run

## Test Results

## Risks

## Handoff Notes
\`\`\`
`;
}

function createReviewerDispatchPrompt({ runId, runRoot, runJson, worktreesRegistry }) {
  const reviewPacketPath = path.join(runRoot, "review-packets", "review-packet.md");
  const reviewerReportPath = path.join(runRoot, "reviews", "reviewer-report.md");
  const reviewerEventPath = path.join(runRoot, "events", "reviewer.jsonl");
  const worktreeLines = worktreesRegistry.worktrees.length === 0
    ? "- none"
    : worktreesRegistry.worktrees
      .map((entry) => `- ${entry.taskId || "unknown-task"} / ${entry.assignedRole || "unassigned"}: ${entry.path || "missing path"}`)
      .join("\n");

  return `# CEWP Dispatch Prompt - Reviewer

Run ID: ${runId}
Repo root: ${(runJson && runJson.repoRoot) || process.cwd()}
Run root: ${runRoot}
Review packet: ${reviewPacketPath}
Worktrees:
${worktreeLines}

## Mission
Review worker output without blindly trusting reports.

## Inputs
- board.json
- tasks/*.json
- reports/*.md
- worktrees status
- review-packets/review-packet.md

## Required Output
- ${relativeRunPath(runRoot, reviewerReportPath)}
- ${relativeRunPath(runRoot, reviewerEventPath)}

## Decision Format
Decision: PASS | REQUEST_CHANGES | BLOCK

## Reviewer Checklist
- Compare worker reports against actual git diff output.
- Check allowedFiles and forbiddenFiles for every task.
- Check verification commands and test output claims.
- Check scope creep and unexpected files.
- Do not implement production feature work.
- Do not merge, push, publish, spawn Codex processes, or automate terminal input.
`;
}

module.exports = {
  createWorkerDispatchPrompt,
  createReviewerDispatchPrompt,
};
