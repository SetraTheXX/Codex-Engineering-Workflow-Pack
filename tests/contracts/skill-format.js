"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { SKILLS } = require("../../src/skills/paths");
const { validateSkillDirectory } = require("../../src/skills/format");

const repoRoot = path.resolve(__dirname, "..", "..");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function runSkillFormatContract() {
  for (const skill of SKILLS) {
    const result = validateSkillDirectory(path.join(repoRoot, ".agents", "skills", skill));
    assert(result.name === skill, `${skill} official-format name`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-skill-format-"));
  const skillRoot = path.join(tempRoot, "official-components");
  try {
    write(
      path.join(skillRoot, "SKILL.md"),
      "---\nname: official-components\ndescription: Exercises supported optional skill components.\n---\n\nUse the bundled resources.\n",
    );
    write(path.join(skillRoot, "scripts", "check.js"), "process.exit(0);\n");
    write(path.join(skillRoot, "references", "guide.md"), "# Guide\n");
    write(path.join(skillRoot, "assets", "template.md"), "# Template\n");
    write(
      path.join(skillRoot, "agents", "openai.yaml"),
      "interface:\n  display_name: Official Components\n",
    );

    const result = validateSkillDirectory(skillRoot);
    assert(result.components.scripts === true, "scripts directory accepted");
    assert(result.components.references === true, "references directory accepted");
    assert(result.components.assets === true, "assets directory accepted");
    assert(result.components.agents === true, "agents directory accepted");
    assert(result.openAiMetadata === true, "agents/openai.yaml accepted");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  runSkillFormatContract();
  console.log("[PASS] all skills match the current optional-component format");
} catch (error) {
  console.error("[FAIL] skill format contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
