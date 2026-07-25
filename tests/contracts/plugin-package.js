"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { getSupportedAdapterNames } = require("../../src/run/adapters/registry");
const { ADAPTER_RESULT_SCHEMA_VERSION } = require("../../src/run/adapters/result");
const { PROVIDER_PROFILE_SCHEMA_VERSION } = require("../../src/run/adapters/profile");
const { validateSkillDirectory } = require("../../src/skills/format");

const repoRoot = path.resolve(__dirname, "..", "..");
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

function runPluginPackageContract() {
  const packageJson = readJson(path.join(repoRoot, "package.json"));
  const manifest = readJson(path.join(repoRoot, "plugins", "cewp", ".codex-plugin", "plugin.json"));
  const marketplace = readJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"));
  const compatibility = readJson(
    path.join(repoRoot, "tests", "fixtures", "compat", "v0.7.0-beta.0", "contracts.json"),
  );

  assert(manifest.name === "cewp", "plugin stable identifier");
  assert(manifest.version === packageJson.version, "plugin and npm versions stay aligned");
  assert(manifest.skills === "./skills/", "plugin skill path is contained and relative");
  assert(manifest.apps === undefined, "plugin does not claim an unbuilt app");
  assert(manifest.mcpServers === undefined, "plugin does not claim an unbuilt MCP server");
  assert(manifest.hooks === "./hooks/hooks.json", "plugin declares one contained reviewable hook bundle");
  const hookConfig = readJson(path.join(repoRoot, "plugins", "cewp", "hooks", "hooks.json"));
  assert(
    JSON.stringify(Object.keys(hookConfig.hooks).sort()) === JSON.stringify(["SubagentStart", "SubagentStop"]),
    "plugin hooks are limited to subagent evidence events",
  );
  assert(
    fs.existsSync(path.join(repoRoot, "plugins", "cewp", "hooks", "capture-subagent.js")),
    "declared hook handler exists",
  );
  assert(
    fs.existsSync(path.join(repoRoot, "plugins", "cewp", "assets", "cewp.svg")),
    "plugin asset exists",
  );

  const skillsRoot = path.join(repoRoot, "plugins", "cewp", "skills");
  const skills = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")))
    .map((entry) => validateSkillDirectory(path.join(skillsRoot, entry.name)));
  const skillNames = skills.map((skill) => skill.name).sort();
  assert(
    JSON.stringify(skillNames) === JSON.stringify([
      "plan-supervised-run",
      "resume-supervised-run",
      "run-supervised-checkpoint",
    ]),
    "plugin ships exactly three focused supervised workflows",
  );
  for (const skill of skills) {
    const content = fs.readFileSync(skill.skillFile, "utf8");
    assert(content.includes("cewp supervise"), `${skill.name} delegates canonical state to CEWP Core`);
    assert(!content.includes("control the native goal"), `${skill.name} does not claim native goal control`);
    assert(!content.includes("run OpenCode"), `${skill.name} does not reopen provider expansion`);
  }
  assert(
    !fs.existsSync(path.join(skillsRoot, "inspect-cewp-run", "SKILL.md")),
    "Phase 8 inspection skeleton is replaced",
  );
  assert(manifest.interface.capabilities.includes("Supervised run planning"), "manifest advertises implemented planning workflow");
  assert(manifest.interface.capabilities.includes("Checkpoint controls"), "manifest advertises implemented checkpoint controls");

  assert(marketplace.name === "cewp-local", "repo marketplace name");
  assert(marketplace.plugins.length === 1, "repo marketplace contains one plugin");
  const entry = marketplace.plugins[0];
  assert(entry.name === manifest.name, "marketplace and manifest names align");
  assert(entry.source.path === "./plugins/cewp", "marketplace path stays repo-relative");
  assert(entry.policy.installation === "AVAILABLE", "plugin install remains opt-in");
  assert(entry.policy.authentication === "ON_INSTALL", "marketplace auth policy is explicit");

  assert(compatibility.schemas.adapterResult === ADAPTER_RESULT_SCHEMA_VERSION, "v0.7 adapter result readable");
  assert(
    compatibility.schemas.providerProfile === PROVIDER_PROFILE_SCHEMA_VERSION,
    "v0.7 provider profile readable",
  );
  assert(
    JSON.stringify(compatibility.adapters) === JSON.stringify(getSupportedAdapterNames()),
    "v0.7 adapter registry remains readable without adding providers",
  );
}

try {
  runPluginPackageContract();
  console.log("[PASS] plugin package and v0.7 compatibility contracts");
} catch (error) {
  console.error("[FAIL] plugin package contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
