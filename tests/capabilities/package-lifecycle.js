"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { assessDowngradeCompatibility } = require("../../src/compatibility/contract");

const repoRoot = path.resolve(__dirname, "..", "..");
const packageJson = require(path.join(repoRoot, "package.json"));
const npmCli = process.env.npm_execpath;

function runNpm(args, cwd) {
  const result = childProcess.spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120000,
  });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || `npm failed with ${result.status}`);
  return result.stdout;
}

function runContract() {
  assert(npmCli && fs.existsSync(npmCli), "package lifecycle requires npm_execpath");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-package-lifecycle-"));
  try {
    const legacyRoot = path.join(tempRoot, "legacy");
    const packRoot = path.join(tempRoot, "packs");
    const prefix = path.join(tempRoot, "prefix");
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.mkdirSync(packRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "package.json"), `${JSON.stringify({
      name: packageJson.name,
      version: "0.13.0-beta.0",
      files: ["marker.txt"],
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(legacyRoot, "marker.txt"), "legacy fixture\n");
    const legacyPack = JSON.parse(runNpm(["pack", "--json", "--pack-destination", packRoot], legacyRoot))[0];
    const currentPack = JSON.parse(runNpm(["pack", "--json", "--pack-destination", packRoot], repoRoot))[0];
    runNpm(["install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", path.join(packRoot, legacyPack.filename)], tempRoot);
    const installedPackage = path.join(prefix, "node_modules", "@setrathex", "codex-engineering-workflow-pack", "package.json");
    assert(JSON.parse(fs.readFileSync(installedPackage, "utf8")).version === "0.13.0-beta.0", "legacy fixture installs cleanly");
    runNpm(["install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", path.join(packRoot, currentPack.filename)], tempRoot);
    assert(JSON.parse(fs.readFileSync(installedPackage, "utf8")).version === packageJson.version, "current package upgrades the legacy fixture");
    const downgrade = assessDowngradeCompatibility("0.13.0-beta.0", packageJson.version);
    assert(downgrade.compatible === false && downgrade.warning, "downgrade receives a non-mutating warning");
    runNpm(["uninstall", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", packageJson.name], tempRoot);
    assert(!fs.existsSync(path.dirname(installedPackage)), "uninstall removes the upgraded package");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  runContract();
  console.log(`[PASS] package install, upgrade, downgrade warning, and uninstall (${packageJson.version})`);
} catch (error) {
  console.error("[FAIL] package lifecycle capability");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
