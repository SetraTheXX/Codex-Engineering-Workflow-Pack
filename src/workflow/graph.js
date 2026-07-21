"use strict";

function validateTaskGraph(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const dependencyId of task.dependsOn) {
      if (!byId.has(dependencyId)) {
        throw new Error(`Workflow task ${task.id} has missing dependency ${dependencyId}.`);
      }
    }
  }

  const state = new Map();
  const stack = [];
  function visit(taskId) {
    if (state.get(taskId) === "done") return;
    if (state.get(taskId) === "visiting") {
      const cycleStart = stack.indexOf(taskId);
      const cycle = [...stack.slice(cycleStart), taskId];
      throw new Error(`Workflow dependency cycle: ${cycle.join(" -> ")}.`);
    }
    state.set(taskId, "visiting");
    stack.push(taskId);
    for (const dependencyId of [...byId.get(taskId).dependsOn].sort()) visit(dependencyId);
    stack.pop();
    state.set(taskId, "done");
  }
  for (const taskId of [...byId.keys()].sort()) visit(taskId);

  const remainingDependencies = new Map(
    tasks.map((task) => [task.id, new Set(task.dependsOn)]),
  );
  const ordered = [];
  while (ordered.length < tasks.length) {
    const ready = [...remainingDependencies.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([taskId]) => taskId)
      .sort();
    for (const taskId of ready) {
      ordered.push(byId.get(taskId));
      remainingDependencies.delete(taskId);
      for (const dependencies of remainingDependencies.values()) dependencies.delete(taskId);
    }
  }
  return ordered;
}

function normalizeScopeRoot(scope) {
  return String(scope).replace(/\/(?:\*\*|\*)$/, "").replace(/\/$/, "").toLowerCase();
}

function scopesOverlap(left, right) {
  const leftRoot = normalizeScopeRoot(left);
  const rightRoot = normalizeScopeRoot(right);
  return leftRoot === rightRoot
    || leftRoot.startsWith(`${rightRoot}/`)
    || rightRoot.startsWith(`${leftRoot}/`);
}

function dependsTransitively(byId, taskId, dependencyId, seen = new Set()) {
  if (seen.has(taskId)) return false;
  seen.add(taskId);
  const task = byId.get(taskId);
  if (task.dependsOn.includes(dependencyId)) return true;
  return task.dependsOn.some((parentId) => dependsTransitively(byId, parentId, dependencyId, seen));
}

function validateTaskScopeOverlaps(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const left = tasks[leftIndex];
      const right = tasks[rightIndex];
      if (
        dependsTransitively(byId, left.id, right.id)
        || dependsTransitively(byId, right.id, left.id)
      ) {
        continue;
      }
      const conflict = left.allowedFiles.find((leftScope) => (
        right.allowedFiles.some((rightScope) => scopesOverlap(leftScope, rightScope))
      ));
      if (conflict) {
        throw new Error(`Workflow scope overlap: ${left.id} and ${right.id} both allow ${conflict}.`);
      }
    }
  }
  return tasks;
}

module.exports = {
  scopesOverlap,
  validateTaskGraph,
  validateTaskScopeOverlaps,
};
