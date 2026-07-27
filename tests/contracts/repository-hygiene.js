"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { assert } = require("../harness/lib/assertions");

const repoRoot = path.join(__dirname, "..", "..");

function gitFiles() {
  const result = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  assert(result.status === 0, `git ls-files succeeds: ${result.stderr}`);
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(repoRoot, file)));
}

function runContract() {
  const tracked = gitFiles();
  const forbiddenPaths = [
    /^docs\/plans\//,
    /roadmap/i,
    /^\.cewp(?:-private)?\//,
  ];
  for (const file of tracked) {
    assert(!forbiddenPaths.some((pattern) => pattern.test(file)), `tracked public path is repository-ready: ${file}`);
  }

  const textFiles = tracked.filter((file) => /\.(?:md|json|ya?ml|js|ps1|sh|txt|gitignore)$/i.test(file) || file === ".gitignore");
  const personalPatterns = [
    /C:\\Users\\[^<\s]+/i,
    /C:\/Users\/[^<\s]+/i,
    /\/Users\/[^<\s]+/i,
    /\/home\/[^<\s]+/i,
    /\btunca\b/i,
  ];
  for (const file of textFiles) {
    const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert(!personalPatterns.some((pattern) => pattern.test(content)), `tracked text contains no personal machine identity: ${file}`);
  }

  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  for (const heading of ["## Why CEWP", "## Quick Start", "## Safety Model", "## Documentation", "## Project Status"]) {
    assert(readme.includes(heading), `README includes ${heading}`);
  }
  assert(!/dogfood|run id|pilot id/i.test(readme), "README contains no personal acceptance-run narrative");

  const ignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
  for (const entry of [".cewp/", ".cewp-private/", "docs/plans/"]) {
    assert(ignore.includes(entry), `.gitignore protects ${entry}`);
  }
}

try {
  runContract();
  console.log("[PASS] professional repository hygiene");
} catch (error) {
  console.error("[FAIL] professional repository hygiene");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
