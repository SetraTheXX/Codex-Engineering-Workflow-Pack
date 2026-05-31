"use strict";

const fs = require("node:fs");
const path = require("node:path");

function markdownList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "none";
  }

  return value.map((item) => `\`${item}\``).join(", ");
}

function getTaskStatusCountsFromTasks(tasks) {
  return tasks.reduce((counts, task) => {
    const status = task.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function getReportExcerpt(filePath, maxLines = 24) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const excerpt = lines.slice(0, maxLines).join("\n").trim();
  const suffix = lines.length > maxLines ? "\n\n...(truncated)" : "";
  return `${excerpt || "(empty report)"}${suffix}`;
}

function findReviewerDecision(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/\b(PASS|REQUEST_CHANGES|BLOCK)\b/);
  return match ? match[1] : "not found";
}

function makeReviewPacket({
  runId,
  runRoot,
  runJson,
  boardJson,
  tasks,
  registry,
  worktreeSnapshots,
  reportFiles,
  reviewFiles,
  recentEvents,
  warnings,
}) {
  const lines = [];
  const roleStatuses = (boardJson && boardJson.roles) || {};
  const statusCounts = getTaskStatusCountsFromTasks(tasks);

  lines.push("# CEWP Review Packet", "");

  lines.push("## Run Summary", "");
  lines.push(`- Run ID: ${runId}`);
  lines.push(`- Run status: ${(runJson && runJson.status) || "unknown"}`);
  lines.push(`- Board status: ${(boardJson && boardJson.status) || "unknown"}`);
  lines.push(`- Repo root: ${(runJson && runJson.repoRoot) || "unknown"}`);
  lines.push(`- Created at: ${(runJson && runJson.createdAt) || "unknown"}`);
  lines.push(`- Run root: ${runRoot}`, "");

  lines.push("## Board Summary", "");
  lines.push("Role statuses:");
  if (Object.keys(roleStatuses).length === 0) {
    lines.push("- none");
  } else {
    for (const role of Object.keys(roleStatuses).sort()) {
      lines.push(`- ${role}: ${roleStatuses[role].status || "unknown"}`);
    }
  }
  lines.push("");
  lines.push("Task status counts:");
  if (Object.keys(statusCounts).length === 0) {
    lines.push("- none");
  } else {
    for (const status of Object.keys(statusCounts).sort()) {
      lines.push(`- ${status}: ${statusCounts[status]}`);
    }
  }
  lines.push("");

  lines.push("## Tasks", "");
  if (tasks.length === 0) {
    lines.push("- No task files found.", "");
  } else {
    for (const task of tasks) {
      lines.push(`### ${task.id || "unknown-task"}`);
      lines.push(`- Title: ${task.title || "(untitled)"}`);
      lines.push(`- Assigned role: ${task.assignedRole || "unassigned"}`);
      lines.push(`- Status: ${task.status || "unknown"}`);
      lines.push(`- Branch: ${task.branch || "none"}`);
      lines.push(`- Target worktree: ${task.targetWorktree || "none"}`);
      lines.push(`- Allowed files: ${markdownList(task.allowedFiles)}`);
      lines.push(`- Forbidden files: ${markdownList(task.forbiddenFiles)}`);
      lines.push(`- Verification: ${markdownList(task.verification)}`);
      lines.push("");
    }
  }

  lines.push("## Worktrees", "");
  if (!registry) {
    lines.push("No worktrees.json found. Worktree diffs were not collected.", "");
  } else if (worktreeSnapshots.length === 0) {
    lines.push("No registered worktrees found.", "");
  } else {
    for (const snapshot of worktreeSnapshots) {
      lines.push(`### ${snapshot.taskId} / ${snapshot.assignedRole}`);
      lines.push(`- Branch: ${snapshot.branch}`);
      lines.push(`- Current branch: ${snapshot.branchName}`);
      lines.push(`- Path: ${snapshot.path}`);
      lines.push(`- Path exists: ${snapshot.exists ? "yes" : "no"}`);
      lines.push(`- Git worktree: ${snapshot.isGitWorktree ? "yes" : "no"}`);
      lines.push(`- Git status: ${snapshot.gitStatus}`);
      lines.push(`- Base commit: ${snapshot.baseCommit || "missing"}`);
      lines.push(`- Working tree changes: ${snapshot.statusChangedFiles.length ? snapshot.statusChangedFiles.join(", ") : "none"}`);
      lines.push(`- Committed branch changes: ${snapshot.committedChangedFiles.length ? snapshot.committedChangedFiles.join(", ") : snapshot.committedDiffError ? "failed to collect" : "none"}`);
      lines.push(`- Combined changed files: ${snapshot.changedFiles.length ? snapshot.changedFiles.join(", ") : "none"}`);
      lines.push("");
    }
  }

  lines.push("## Changed Files", "");
  if (worktreeSnapshots.length === 0) {
    lines.push("- none", "");
  } else {
    for (const snapshot of worktreeSnapshots) {
      lines.push(`### ${snapshot.taskId}`);
      if (snapshot.statusChangedFiles.length === 0) {
        lines.push("Working tree changes:");
        lines.push("- none");
      } else {
        lines.push("Working tree changes:");
        for (const line of snapshot.statusLines) {
          lines.push(`- ${line}`);
        }
      }
      lines.push("");
      lines.push("Committed branch changes:");
      if (snapshot.committedDiffError) {
        lines.push(`- failed to collect: ${snapshot.committedDiffError.message}`);
      } else if (snapshot.committedChangedFiles.length === 0) {
        lines.push("- none");
      } else {
        for (const filePath of snapshot.committedChangedFiles) {
          lines.push(`- ${filePath}`);
        }
      }
      lines.push("");
      lines.push("Combined scope result:");
      lines.push(`- ${snapshot.warnings.length === 0 ? "OK" : "WARN"}`);
      lines.push(`- Changed files: ${snapshot.changedFiles.length ? snapshot.changedFiles.join(", ") : "none"}`);
      lines.push("");
      lines.push("Diff stat:");
      lines.push("```txt");
      lines.push(snapshot.diffStat);
      lines.push("```", "");
    }
  }

  lines.push("## Scope Warnings", "");
  if (warnings.length === 0) {
    lines.push("- none", "");
  } else {
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Worker Reports", "");
  if (reportFiles.length === 0) {
    lines.push("- No worker report files found.", "");
  } else {
    for (const filePath of reportFiles) {
      lines.push(`### ${path.basename(filePath)}`);
      lines.push("```md");
      lines.push(getReportExcerpt(filePath));
      lines.push("```", "");
    }
  }

  lines.push("## Reviewer Reports", "");
  if (reviewFiles.length === 0) {
    lines.push("- No reviewer report files found.", "");
  } else {
    for (const filePath of reviewFiles) {
      lines.push(`- ${path.basename(filePath)}: decision ${findReviewerDecision(filePath)}`);
    }
    lines.push("");
  }

  lines.push("## Recent Events", "");
  if (recentEvents.length === 0) {
    lines.push("- none", "");
  } else {
    for (const event of recentEvents) {
      lines.push(`- ${event.file}: \`${JSON.stringify(event.value)}\``);
    }
    lines.push("");
  }

  lines.push("## Suggested Reviewer Checklist", "");
  lines.push("- Compare changed files against allowedFiles.");
  lines.push("- Check forbiddenFiles for every task.");
  lines.push("- Compare worker reports against actual git diff output.");
  lines.push("- Verify reported commands and test outputs.");
  lines.push("- Check docs/code consistency.");
  lines.push("- Decide: PASS / REQUEST_CHANGES / BLOCK.");
  lines.push("");

  lines.push("## Notes", "");
  lines.push("- This packet is generated by `cewp run collect`.");
  lines.push("- It does not merge, push, publish, mutate board/task JSON, create worktrees, or remove worktrees.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

module.exports = {
  makeReviewPacket,
};
