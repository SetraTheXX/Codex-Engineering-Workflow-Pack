"use strict";

const ACTIVE_TASK_STATUSES = new Set(["running", "verifying"]);

function deriveSchedule(run, definition) {
  const runtimeById = new Map(run.tasks.map((task) => [task.id, task]));
  const definitionIds = new Set(definition.tasks.map((task) => task.id));
  if (
    runtimeById.size !== run.tasks.length
    || runtimeById.size !== definitionIds.size
    || [...runtimeById.keys()].some((taskId) => !definitionIds.has(taskId))
  ) {
    throw new Error("Run task state does not match its approved workflow definition.");
  }
  const active = run.tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const maximum = run.budget.maxConcurrentWorkers;
  const available = Math.max(0, maximum - active.length);
  const blockedByDependency = [];
  const readyTasks = [];
  for (const task of definition.tasks) {
    const runtime = runtimeById.get(task.id);
    const dependencyStates = task.dependsOn.map((dependencyId) => runtimeById.get(dependencyId));
    const failedDependencies = dependencyStates.filter((dependency) => (
      ["failed", "blocked", "cancelled", "timed-out", "rolled-back", "abandoned"].includes(dependency.status)
    ));
    if (failedDependencies.length > 0) {
      blockedByDependency.push({
        id: task.id,
        dependencies: failedDependencies.map((dependency) => dependency.id).sort(),
      });
      continue;
    }
    const dependenciesComplete = dependencyStates.every((dependency) => dependency.status === "completed");
    if (runtime.status === "ready" && dependenciesComplete) {
      readyTasks.push({
        id: task.id,
        title: task.title,
        risk: task.risk,
        allowedFiles: task.allowedFiles,
      });
    }
  }
  return {
    readyTasks: readyTasks.slice(0, available),
    queuedReadyTasks: readyTasks.slice(available),
    blockedByDependency,
    capacity: {
      maximum,
      active: active.length,
      available,
    },
  };
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  deriveSchedule,
};
