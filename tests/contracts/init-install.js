"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assert,
  assertExit,
  assertFileExists,
  assertIncludes,
  formatCommandResult,
} = require("../harness/lib/assertions");
const { SKILLS } = require("../../src/skills/paths");

const cewpRoot = path.resolve(__dirname, "..", "..");

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    } else {
      throw new Error(`Unsupported fixture entry: ${sourcePath}`);
    }
  }
}

function assertProcessDidNotCrash(child, result) {
  const hasWindowsCrashStatus =
    process.platform === "win32" && Number.isInteger(child.status) && child.status > 255;

  assert(
    child.signal === null && !hasWindowsCrashStatus,
    `Unicode source init ended in a process crash.\n${formatCommandResult(result)}`,
  );
}

function runUnicodeSourceInstallContract() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-init-contract-"));
  const packageRoot = path.join(tempRoot, "Güncel paket");
  const targetRoot = path.join(tempRoot, "target-repo");

  try {
    fs.mkdirSync(targetRoot, { recursive: true });
    copyTree(path.join(cewpRoot, "bin"), path.join(packageRoot, "bin"));
    copyTree(path.join(cewpRoot, "src"), path.join(packageRoot, "src"));
    copyTree(path.join(cewpRoot, ".agents", "skills"), path.join(packageRoot, ".agents", "skills"));

    const cliPath = path.join(packageRoot, "bin", "cewp.js");
    const args = [cliPath, "init", "--mode", "repo", "--target", targetRoot];
    const child = childProcess.spawnSync(process.execPath, args, {
      cwd: targetRoot,
      encoding: "utf8",
      shell: false,
      timeout: 120000,
      windowsHide: true,
    });
    const result = {
      command: [process.execPath, ...args].join(" "),
      status: child.status,
      stdout: child.stdout || "",
      stderr: `${child.stderr || ""}${child.error ? child.error.message : ""}`,
    };

    assertProcessDidNotCrash(child, result);
    assertExit(result, 0, "Unicode source init");
    assertIncludes(result.stdout, "Install summary", "Unicode source init output");

    for (const skill of SKILLS) {
      assertFileExists(
        path.join(targetRoot, ".agents", "skills", skill, "SKILL.md"),
        `installed ${skill}`,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  runUnicodeSourceInstallContract();
  console.log("[PASS] init supports Unicode package source paths");
} catch (error) {
  console.error("[FAIL] init supports Unicode package source paths");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
