"use strict";

const PROGRESS_VIEW_SCHEMA_VERSION = "progress-view/v1";

function assertEvidenceGates(run, definition) {
  const runtimeById = new Map(run.tasks.map((task) => [task.id, task]));
  for (const definitionTask of definition.tasks) {
    const task = runtimeById.get(definitionTask.id);
    if (!task) throw new Error(`Progress cannot find canonical task state: ${definitionTask.id}.`);
    if (
      task.status === "completed"
      && (!task.resultId || !task.verification || task.verification.status !== "passed")
    ) {
      throw new Error(`Workflow task ${task.id} claims completed without a result and passing verification evidence.`);
    }
  }
  const allComplete = run.tasks.every((task) => task.status === "completed");
  if (["review-pending", "completed", "finalized"].includes(run.status) && !allComplete) {
    throw new Error(`Workflow run ${run.runId} claims ${run.status} before every task has verified evidence.`);
  }
  if (
    ["completed", "finalized"].includes(run.status)
    && run.reviewerPolicy.requiredForFinalize
    && run.reviewer.status !== "passed"
  ) {
    throw new Error(`Workflow run ${run.runId} claims ${run.status} without reviewer PASS.`);
  }
}

function nextActionFor(run, definition, schedule) {
  if (run.compatibility && run.compatibility.migrationRequired) {
    return {
      kind: "migration",
      command: `cewp workflow migrate ${run.compatibility.sourceRunId}`,
      reason: `${run.compatibility.sourceSchema} is read-only until explicit backed-up migration`,
    };
  }
  if (["paused-budget-safe", "paused-budget-unverified"].includes(run.status)) {
    return {
      kind: "budget-decision",
      command: `cewp workflow intervene ${run.runId} --event add-budget --operations <count> --allocation <name> --reason <text> --yes`,
      reason: run.budget.pauseReason || "workflow budget is paused",
    };
  }
  if (run.status === "paused-host-limit") {
    return {
      kind: "host-resume",
      command: `cewp workflow intervene ${run.runId} --event resume --reason <text> --yes`,
      reason: "host availability must be restored explicitly",
    };
  }
  const blocked = run.tasks.find((task) => task.status === "blocked");
  if (blocked) {
    const repeated = blocked.blocker && blocked.blocker.classification === "repeated-failure";
    return {
      kind: "intervention",
      command: repeated
        ? `cewp workflow intervene ${run.runId} --task ${blocked.id} --event reassign --worker <worker-id> --reason <text> --yes`
        : `cewp workflow intervene ${run.runId} --task ${blocked.id} --event retry --reason <text> --yes`,
      reason: blocked.blocker ? blocked.blocker.reason : "task is blocked",
    };
  }
  const active = run.tasks.find((task) => ["running", "verifying"].includes(task.status));
  if (active) {
    return {
      kind: "result",
      command: `cewp workflow result ${run.runId} --task ${active.id} --result <task-result.json> --yes`,
      reason: "active checkpoint requires a verified result",
    };
  }
  if (schedule.readyTasks.length > 0 && ["approved", "active"].includes(run.status)) {
    return {
      kind: "start",
      command: `cewp workflow start ${run.runId} --task ${schedule.readyTasks[0].id} --yes`,
      reason: "task dependencies and worker capacity are ready",
    };
  }
  if (run.status === "review-pending") {
    return {
      kind: "review",
      command: `cewp workflow review ${run.runId} --result <review-result.json> --yes`,
      reason: "reviewer PASS is required before completion",
    };
  }
  if (run.status === "completed") {
    return {
      kind: "finalize",
      command: `cewp workflow finalize ${run.runId} --yes`,
      reason: "all configured gates passed; explicit finalization remains",
    };
  }
  return {
    kind: "inspect",
    command: `cewp workflow status ${run.runId}`,
    reason: `no automatic action is available from ${run.status}`,
  };
}

function deriveProgressView(run, definition, schedule, options = {}) {
  assertEvidenceGates(run, definition);
  const runtimeById = new Map(run.tasks.map((task) => [task.id, task]));
  const completed = run.tasks.filter((task) => task.status === "completed").length;
  const active = run.tasks.filter((task) => ["running", "verifying"].includes(task.status)).length;
  const blocked = run.tasks.filter((task) => ["blocked", "failed", "timed-out"].includes(task.status)).length;
  return {
    schemaVersion: PROGRESS_VIEW_SCHEMA_VERSION,
    runId: run.runId,
    workflow: {
      id: run.workflow.id,
      revision: run.workflow.revision,
      digest: run.workflow.digest,
      revisionReason: definition.revision.reason,
      parent: definition.revision.parent,
    },
    generatedAt: (options.now || new Date()).toISOString(),
    status: run.status,
    goal: run.goal,
    summary: {
      total: run.tasks.length,
      completed,
      active,
      blocked,
      remaining: run.tasks.length - completed,
      percent: run.tasks.length === 0 ? 0 : Math.floor((completed / run.tasks.length) * 100),
    },
    tasks: definition.tasks.map((definitionTask) => {
      const task = runtimeById.get(definitionTask.id);
      return {
        id: task.id,
        title: definitionTask.title,
        status: task.status,
        dependsOn: definitionTask.dependsOn,
        attempts: task.attempts,
        activeCheckpointId: task.activeCheckpointId,
        resultId: task.resultId,
        verification: task.verification,
        blocker: task.blocker,
      };
    }),
    scheduler: {
      ready: schedule.readyTasks.map((task) => task.id),
      queued: schedule.queuedReadyTasks.map((task) => task.id),
      blockedByDependency: schedule.blockedByDependency,
      capacity: schedule.capacity,
    },
    budget: {
      modelOperations: {
        budgeted: run.budget.modelOperations,
        observed: run.budget.consumed.modelOperations,
      },
      allocations: run.budget.allocations,
      consumedAllocations: run.budget.consumed.allocations,
      thresholds: run.budget.thresholds,
      pauseReason: run.budget.pauseReason,
      hostLimit: run.budget.hostLimit,
      revisions: run.budget.revisions,
    },
    reviewer: run.reviewer,
    compatibility: run.compatibility || null,
    interventions: run.interventions,
    warnings: run.warnings || [],
    nextAction: nextActionFor(run, definition, schedule),
  };
}

function renderProgressMarkdown(progress) {
  const lines = [
    "# CEWP Workflow Progress",
    "",
    `Run: ${progress.runId}`,
    `Workflow: ${progress.workflow.id} revision ${progress.workflow.revision}`,
    `Status: ${progress.status}`,
    `Progress: ${progress.summary.completed}/${progress.summary.total} (${progress.summary.percent}%)`,
    "",
    "## Tasks",
    "",
  ];
  for (const task of progress.tasks) {
    const evidence = task.resultId ? `; result ${task.resultId}` : "";
    const blocker = task.blocker ? `; blocked: ${task.blocker.classification}` : "";
    lines.push(`- [${task.status === "completed" ? "x" : " "}] ${task.id}: ${task.status}${evidence}${blocker}`);
  }
  lines.push(
    "",
    "## Budget",
    "",
    `Model operations: ${progress.budget.modelOperations.observed}/${progress.budget.modelOperations.budgeted}`,
    `Pause reason: ${progress.budget.pauseReason || "none"}`,
    "",
    "## Next Action",
    "",
    `Reason: ${progress.nextAction.reason}`,
    `Command: ${progress.nextAction.command}`,
    "",
  );
  return lines.join("\n");
}

module.exports = {
  PROGRESS_VIEW_SCHEMA_VERSION,
  assertEvidenceGates,
  deriveProgressView,
  renderProgressMarkdown,
};
