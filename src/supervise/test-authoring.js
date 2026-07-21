"use strict";

const path = require("node:path");

function normalizeFile(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isTestFile(filePath) {
  const normalized = normalizeFile(filePath).toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const basename = path.posix.basename(normalized);
  return segments.some((segment) => ["test", "tests", "__tests__", "spec", "specs"].includes(segment))
    || /(?:^|\.)[^/]+\.(?:test|spec)\.[^.]+$/.test(basename)
    || /^(?:test_.+|.+_test)\.[^.]+$/.test(basename)
    || basename === "conftest.py";
}

function getTestAuthoringVerdict(run, changedFiles) {
  const policy = run.assurance && run.assurance.testAuthoring
    ? run.assurance.testAuthoring
    : "auto";
  const explicitlyApproved = Boolean(run.approval && run.approval.testAuthoringApproved);
  const allowed = policy === "auto" || (policy === "ask" && explicitlyApproved);
  const testFiles = [...new Set((changedFiles || []).filter(isTestFile).map(normalizeFile))];
  const violations = allowed
    ? []
    : testFiles.map((file) => (
      policy === "never"
        ? `Test authoring policy never forbids changes to test file: ${file}`
        : `Test authoring policy ask requires explicit approval for test file: ${file}`
    ));
  return {
    policy,
    explicitlyApproved,
    status: violations.length === 0 ? "pass" : "fail",
    testFiles,
    violations,
  };
}

function renderTestAuthoringInstruction(run) {
  const policy = run.assurance.testAuthoring;
  const approved = Boolean(run.approval && run.approval.testAuthoringApproved);
  if (policy === "never") {
    return "Test authoring policy: never. Do not create or modify test files; approved non-test verification still applies.";
  }
  if (policy === "ask" && !approved) {
    return "Test authoring policy: ask, not approved. Do not create or modify test files; report that explicit operator approval is required.";
  }
  if (policy === "ask") {
    return "Test authoring policy: ask. The operator explicitly approved test authoring inside the allowed scope.";
  }
  return "Test authoring policy: auto. Test files may change only when they are inside the approved scope and necessary for this checkpoint.";
}

module.exports = {
  getTestAuthoringVerdict,
  isTestFile,
  renderTestAuthoringInstruction,
};
