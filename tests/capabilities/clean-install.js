"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");

const repoRoot = path.resolve(__dirname, "..", "..");
const packageName = "@setrathex/codex-engineering-workflow-pack";
const npmCli = process.env.npm_execpath;

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    timeout: options.timeout || 120000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}).\n${result.stdout || ""}${result.stderr || ""}${result.error ? result.error.message : ""}`,
    );
  }
  return result.stdout || "";
}

function runCleanInstall() {
  assert(npmCli && fs.existsSync(npmCli), "clean-install capability requires npm_execpath");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-clean-install-"));
  const packRoot = path.join(tempRoot, "pack");
  const prefix = path.join(tempRoot, "prefix");
  const target = path.join(tempRoot, "target-repo");
  const codexHome = path.join(tempRoot, "codex-home");
  const env = { ...process.env, CODEX_HOME: codexHome };
  delete env.CODEX_ACCESS_TOKEN;
  delete env.OPENAI_API_KEY;

  try {
    fs.mkdirSync(packRoot, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    const packed = JSON.parse(run(process.execPath, [npmCli,
      "pack", "--json", "--pack-destination", packRoot,
    ], { cwd: repoRoot, env }));
    assert(Array.isArray(packed) && packed.length === 1, "npm pack returns one package record");
    const tarball = path.join(packRoot, packed[0].filename);
    assert(fs.existsSync(tarball), "clean-install tarball exists");

    run(process.execPath, [npmCli,
      "install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball,
    ], { cwd: tempRoot, env });
    const installedRoot = path.join(prefix, "node_modules", "@setrathex", "codex-engineering-workflow-pack");
    const cli = path.join(installedRoot, "bin", "cewp.js");
    assert(fs.existsSync(cli), "installed package exposes the CLI");
    assert(fs.existsSync(path.join(installedRoot, "plugins", "cewp", ".codex-plugin", "plugin.json")), "installed package includes the plugin");
    assert(fs.existsSync(path.join(installedRoot, "docs", "supervised-workflow.md")), "installed package includes supervised docs");
    assert(!fs.existsSync(path.join(installedRoot, "docs", "plans")), "development plans are absent from the installed package");
    assert(!fs.existsSync(path.join(installedRoot, ".cewp-private")), "private capability evidence is absent from the installed package");

    run(process.execPath, [cli, "--help"], { cwd: target, env });
    run(process.execPath, [cli, "init", "--mode", "repo", "--target", target], { cwd: target, env });
    const doctor = JSON.parse(run(process.execPath, [
      cli, "doctor", "--mode", "repo", "--target", target, "--json",
    ], { cwd: target, env }));
    assert(doctor.schemaVersion === "doctor-report/v1-beta", "installed doctor report is versioned");
    assert(doctor.status === "pass", "installed package passes repo-mode doctor");
    const demo = JSON.parse(run(process.execPath, [cli, "demo", "supervised", "--json"], {
      cwd: target,
      env,
      timeout: 180000,
    }));
    assert(demo.status === "PASS" && demo.cleanup === "complete", "installed CLI completes the credential-free demo");
    assert(!fs.existsSync(path.join(codexHome, "auth.json")), "clean install and demo create no Codex auth file");

    run(process.execPath, [npmCli,
      "uninstall", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", packageName,
    ], { cwd: tempRoot, env });
    assert(!fs.existsSync(installedRoot), "npm uninstall removes the installed package");
    return packed[0].version;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  const version = runCleanInstall();
  console.log(`[PASS] clean npm install, doctor, demo, and uninstall (${version})`);
} catch (error) {
  console.error("[FAIL] clean npm install capability");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
