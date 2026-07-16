"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { evaluateControlledOperation } = require("../../src/run/control-gates");

const fixtureRoot = path.join(__dirname, "..", "fixtures", "ownership");
const readFixture = (name) => JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, name), "utf8"),
);

function runOwnershipGateContract() {
  const managed = readFixture("managed-active.json");
  const native = readFixture("native-conflict.json");
  const noWarnings = {
    conversation: false,
    hook: false,
    app: false,
    notification: false,
  };

  const closed = evaluateControlledOperation({
    coreGate: { status: "closed", reason: "operational-budget-exhausted" },
    warningSurfaces: noWarnings,
    ownershipRecords: [managed],
    requestedOwnership: managed,
  });
  assert(closed.allowed === false, "closed Core gate blocks operation");
  assert(closed.warningAvailable === false, "warning surface remains unavailable");

  const conflict = evaluateControlledOperation({
    coreGate: { status: "open" },
    warningSurfaces: noWarnings,
    ownershipRecords: [managed],
    requestedOwnership: native,
  });
  assert(conflict.allowed === false, "host and child cannot share task worktree");
  assert(conflict.reason === "execution-ownership-conflict", "ownership conflict reason");
  assert(
    conflict.fallback === "generated-goal-or-explicit-intake",
    "unsafe nested dispatch selects documented fallback",
  );

  const resume = evaluateControlledOperation({
    coreGate: { status: "open" },
    warningSurfaces: noWarnings,
    ownershipRecords: [managed],
    requestedOwnership: managed,
  });
  assert(resume.allowed === true, "same managed owner/backend can resume");
}

try {
  runOwnershipGateContract();
  console.log("[PASS] Core gates and execution ownership remain authoritative");
} catch (error) {
  console.error("[FAIL] ownership and Core gate contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
