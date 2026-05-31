"use strict";

function roleLabel(role) {
  if (role === "manager") {
    return "Manager";
  }

  if (role === "reviewer") {
    return "Reviewer";
  }

  const workerMatch = role.match(/^worker-([a-z])$/);
  if (workerMatch) {
    return `Worker ${workerMatch[1].toUpperCase()}`;
  }

  return role;
}

function makePlanTemplate(runId) {
  return `# CEWP Coordinator Run Plan

Run ID: ${runId}

## Goal

Describe the user goal for this coordinated run.

## Manager Plan

- Define isolated tasks.
- Assign each task to one worker.
- Keep board.json Manager/CLI-owned.
- Send completed worker output through the reviewer gate.

## Task Schema

\`\`\`json
{
  "schemaVersion": 1,
  "id": "task-001",
  "title": "Short task title",
  "status": "todo",
  "assignedRole": "worker-a",
  "dependsOn": [],
  "targetWorktree": "../.cewp-worktrees/<repo-name>/<run-id>/task-001",
  "branch": "cewp/task-001",
  "mission": "Precise implementation mission.",
  "allowedFiles": [],
  "forbiddenFiles": [".env", "config/api_keys.json"],
  "verification": [],
  "outputContract": {
    "summary": true,
    "changedFiles": true,
    "commandsRun": true,
    "tests": true,
    "risks": true,
    "handoff": true
  }
}
\`\`\`

Allowed task statuses: todo, claimed, in_progress, blocked, ready_for_review, review_failed, approved, merged, done.

## Worktree Guidance

v0.2 does not create worktrees automatically. Parallel workers must not edit the same working tree.

Recommended path:

\`\`\`txt
../.cewp-worktrees/<repo-name>/<run-id>/<task-id>/
\`\`\`
`;
}

function makeAgentFile(role, runId) {
  return `# ${roleLabel(role)}

Run ID: ${runId}
Role: ${role}

Use the matching prompt under prompts/ when starting this Codex session.
`;
}

function makeManagerPrompt({ runId, runRoot, repoRoot, workers }) {
  return `# CEWP Coordinator Mode - Manager Prompt

You are the Manager Codex for CEWP run ${runId}.

Repo root:
${repoRoot}

Run root:
${runRoot}

Your mission:
- Read the repo context and the user's goal.
- Produce a concise plan in plan.md.
- Split work into isolated task JSON files under tasks/.
- Update board.json as the Manager-owned coordination board.
- Define each task's allowedFiles and forbiddenFiles boundaries.
- Ask the Reviewer to gate worker output before any merge decision.

Hard rules:
- Do not edit production code.
- board.json may be written only by Manager/CLI.
- Workers may read board.json and tasks/*.json but must not write board.json.
- Do not merge.
- Do not push.
- Do not publish.
- Do not spawn Codex processes.
- Do not automate terminal input.
- Do not create worktrees automatically in v0.2.

Workers for this run:
${workers.map((worker) => `- ${worker}`).join("\n")}

Task schema to use:

\`\`\`json
{
  "schemaVersion": 1,
  "id": "task-001",
  "title": "Short task title",
  "status": "todo",
  "assignedRole": "worker-a",
  "dependsOn": [],
  "targetWorktree": "../.cewp-worktrees/<repo-name>/<run-id>/task-001",
  "branch": "cewp/task-001",
  "mission": "Precise implementation mission.",
  "allowedFiles": [],
  "forbiddenFiles": [".env", "config/api_keys.json"],
  "verification": [],
  "outputContract": {
    "summary": true,
    "changedFiles": true,
    "commandsRun": true,
    "tests": true,
    "risks": true,
    "handoff": true
  }
}
\`\`\`

Allowed task statuses:
todo, claimed, in_progress, blocked, ready_for_review, review_failed, approved, merged, done.

Worktree guidance:
- v0.2 only recommends worktree paths.
- Parallel workers must not work in the same working tree.
- Recommended path: ../.cewp-worktrees/<repo-name>/${runId}/<task-id>/
`;
}

function makeWorkerPrompt({ runId, runRoot, repoRoot, role }) {
  return `# CEWP Coordinator Mode - ${roleLabel(role)} Prompt

You are ${roleLabel(role)} for CEWP run ${runId}.

Repo root:
${repoRoot}

Run root:
${runRoot}

Your mission:
- Work only on the task assigned to ${role}.
- Read board.json and tasks/*.json.
- Follow the task mission, allowedFiles, forbiddenFiles, and verification list.
- Run verification commands when possible.
- Write your report to reports/${role}-report.md.
- Append your events to events/${role}.jsonl.

Hard rules:
- Do not write board.json.
- Do not edit tasks/*.json unless the Manager explicitly changes the run design.
- Do not work outside your assigned task.
- Do not edit files outside allowedFiles when allowedFiles is non-empty.
- Do not touch forbiddenFiles.
- Do not merge.
- Do not push.
- Do not publish.
- Do not spawn Codex processes.
- Do not automate terminal input.
- Do not work in the same working tree as another parallel worker.

Report template:

\`\`\`md
# Worker Report

Role: ${role}
Task:
Status:

## Summary

## Changed Files

## Commands Run

## Test Results

## Risks

## Handoff Notes
\`\`\`

Event JSONL guidance:
- Append one JSON object per line to events/${role}.jsonl.
- Include at least timestamp, role, event, and optional task id.
`;
}

function makeReviewerPrompt({ runId, runRoot, repoRoot }) {
  return `# CEWP Coordinator Mode - Reviewer Prompt

You are the Reviewer/Debugger Codex for CEWP run ${runId}.

Repo root:
${repoRoot}

Run root:
${runRoot}

Your mission:
- Review worker output without blindly trusting worker reports.
- Inspect changed files, diffs, test output, forbidden file touches, and scope creep.
- Read board.json, tasks/*.json, reports/*.md, and relevant git output.
- Write your review to reviews/reviewer-report.md.
- Append your events to events/reviewer.jsonl.

Hard rules:
- Do not implement production features.
- Do not write board.json.
- Do not write worker reports.
- Do not merge.
- Do not push.
- Do not publish.
- Do not spawn Codex processes.
- Do not automate terminal input.

Decision format:

\`\`\`md
# Reviewer Report

Decision: PASS | REQUEST_CHANGES | BLOCK

## Scope Check

## Forbidden File Check

## Diff Review

## Verification

## Required Changes

## Notes
\`\`\`
`;
}

module.exports = {
  roleLabel,
  makePlanTemplate,
  makeAgentFile,
  makeManagerPrompt,
  makeWorkerPrompt,
  makeReviewerPrompt,
};
