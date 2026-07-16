"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");

const repoRoot = path.resolve(__dirname, "..", "..");
const sourcePluginRoot = path.join(repoRoot, "plugins", "cewp");

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
      throw new Error(`Unsupported plugin fixture entry: ${sourcePath}`);
    }
  }
}

function run(command, args, env) {
  const result = childProcess.spawnSync(command, args, {
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}).\n${result.stdout || ""}${result.stderr || ""}${result.error ? result.error.message : ""}`,
    );
  }
  return result.stdout || "";
}

function findPlugin(list, installed) {
  return (installed ? list.installed : list.available)
    .find((plugin) => plugin.pluginId === "cewp@cewp-fixture");
}

function setPluginEnabled(configPath, enabled) {
  const content = fs.readFileSync(configPath, "utf8");
  const current = enabled ? "enabled = false" : "enabled = true";
  const replacement = enabled ? "enabled = true" : "enabled = false";
  assert(content.includes(current), `isolated config contains ${current}`);
  fs.writeFileSync(configPath, content.replace(current, replacement));
}

function runLifecycle(command) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-plugin-lifecycle-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const marketplaceRoot = path.join(tempRoot, "marketplace");
  const pluginRoot = path.join(marketplaceRoot, "plugins", "cewp");
  const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
  const marketplacePath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
  };
  delete env.CODEX_ACCESS_TOKEN;
  delete env.OPENAI_API_KEY;

  try {
    fs.mkdirSync(codexHome, { recursive: true });
    copyTree(sourcePluginRoot, pluginRoot);
    const initialManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const initialVersion = initialManifest.version;
    fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
    fs.writeFileSync(
      marketplacePath,
      `${JSON.stringify({
        name: "cewp-fixture",
        interface: { displayName: "CEWP Fixture" },
        plugins: [{
          name: "cewp",
          source: { source: "local", path: "./plugins/cewp" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        }],
      }, null, 2)}\n`,
    );

    run(command, ["plugin", "marketplace", "add", marketplaceRoot], env);
    let list = JSON.parse(run(command, ["plugin", "list", "--available", "--json"], env));
    assert(findPlugin(list, false)?.installed === false, "clean plugin is available but not installed");
    assert(findPlugin(list, false)?.version === initialVersion, "available plugin version");

    run(command, ["plugin", "add", "cewp@cewp-fixture"], env);
    list = JSON.parse(run(command, ["plugin", "list", "--json"], env));
    assert(findPlugin(list, true)?.enabled === true, "plugin installs enabled");
    assert(
      fs.existsSync(path.join(
        codexHome,
        "plugins",
        "cache",
        "cewp-fixture",
        "cewp",
        initialVersion,
        "skills",
        "inspect-cewp-run",
        "SKILL.md",
      )),
      "installed cache contains the plugin skill",
    );

    const configPath = path.join(codexHome, "config.toml");
    setPluginEnabled(configPath, false);
    list = JSON.parse(run(command, ["plugin", "list", "--json"], env));
    assert(findPlugin(list, true)?.enabled === false, "isolated config disables plugin");
    setPluginEnabled(configPath, true);

    const upgradedVersion = `${initialVersion.split("+")[0]}+codex.upgrade-fixture`;
    initialManifest.version = upgradedVersion;
    fs.writeFileSync(manifestPath, `${JSON.stringify(initialManifest, null, 2)}\n`);
    run(command, ["plugin", "add", "cewp@cewp-fixture"], env);
    list = JSON.parse(run(command, ["plugin", "list", "--json"], env));
    assert(
      findPlugin(list, true)?.version === upgradedVersion,
      "cachebuster reinstall upgrades local plugin",
    );

    run(command, ["plugin", "remove", "cewp@cewp-fixture"], env);
    list = JSON.parse(run(command, ["plugin", "list", "--available", "--json"], env));
    assert(findPlugin(list, false)?.installed === false, "plugin uninstall returns to available state");
    assert(!fs.existsSync(path.join(codexHome, "auth.json")), "lifecycle does not create or copy auth");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const command = process.env.CEWP_CODEX_COMMAND || "codex";
const version = childProcess.spawnSync(command, ["--version"], {
  encoding: "utf8",
  shell: false,
  windowsHide: true,
});

if (version.error || version.status !== 0) {
  console.log("[SKIP] Codex CLI unavailable; deterministic plugin package contract still runs in npm test");
} else {
  try {
    runLifecycle(command);
    console.log(`[PASS] plugin install, disable, upgrade, and uninstall lifecycle (${String(version.stdout).trim()})`);
  } catch (error) {
    console.error("[FAIL] plugin lifecycle capability contract");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}
