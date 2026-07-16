"use strict";

const { findOwnershipConflict } = require("./ownership");

function hasWarningSurface(surfaces = {}) {
  return ["conversation", "hook", "app", "notification"].some(
    (name) => surfaces[name] === true,
  );
}

function evaluateControlledOperation(input, options = {}) {
  const gate = input.coreGate || {};
  if (gate.status !== "open" && gate.status !== "closed") {
    throw new Error("Invalid Core gate status. Expected open or closed.");
  }

  const warningAvailable = hasWarningSurface(input.warningSurfaces);
  if (gate.status === "closed") {
    return {
      allowed: false,
      reason: gate.reason || "core-gate-closed",
      warningAvailable,
      fallback: "inspect-or-resume",
    };
  }

  const conflict = findOwnershipConflict(
    input.ownershipRecords || [],
    input.requestedOwnership,
    options,
  );
  if (conflict) {
    return {
      allowed: false,
      reason: "execution-ownership-conflict",
      warningAvailable,
      fallback: "generated-goal-or-explicit-intake",
    };
  }

  return {
    allowed: true,
    reason: "core-gates-open",
    warningAvailable,
    fallback: null,
  };
}

module.exports = {
  evaluateControlledOperation,
  hasWarningSurface,
};
