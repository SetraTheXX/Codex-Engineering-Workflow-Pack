"use strict";

const fs = require("fs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertExit(result, expectedStatus, label) {
  assert(
    result.status === expectedStatus,
    `${label} exited ${result.status}, expected ${expectedStatus}.\n${formatCommandResult(result)}`,
  );
}

function assertIncludes(value, expected, label) {
  assert(
    String(value).includes(expected),
    `${label} did not include ${JSON.stringify(expected)}.\nActual:\n${String(value).slice(0, 2000)}`,
  );
}

function assertNotIncludes(value, unexpected, label) {
  assert(
    !String(value).includes(unexpected),
    `${label} included unexpected ${JSON.stringify(unexpected)}.\nActual:\n${String(value).slice(0, 2000)}`,
  );
}

function assertFileExists(filePath, label) {
  assert(fs.existsSync(filePath), `${label} missing: ${filePath}`);
}

function assertFileMissing(filePath, label) {
  assert(!fs.existsSync(filePath), `${label} should not exist: ${filePath}`);
}

function formatCommandResult(result) {
  return [
    `Command: ${result.command}`,
    `Exit: ${result.status}`,
    `stdout:\n${String(result.stdout || "").slice(0, 2000)}`,
    `stderr:\n${String(result.stderr || "").slice(0, 2000)}`,
  ].join("\n");
}

module.exports = {
  assert,
  assertExit,
  assertIncludes,
  assertNotIncludes,
  assertFileExists,
  assertFileMissing,
  formatCommandResult,
};
