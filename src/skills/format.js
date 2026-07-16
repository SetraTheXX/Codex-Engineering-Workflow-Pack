"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OPTIONAL_SKILL_DIRECTORIES = Object.freeze([
  "scripts",
  "references",
  "assets",
  "agents",
]);

function parseFrontmatter(content, skillFile) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error(`Invalid skill metadata: ${skillFile}. Missing YAML frontmatter.`);
  }

  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    metadata[key] = value;
  }

  return metadata;
}

function validateOptionalDirectory(skillRoot, name) {
  const entryPath = path.join(skillRoot, name);
  if (!fs.existsSync(entryPath)) {
    return false;
  }
  if (!fs.statSync(entryPath).isDirectory()) {
    throw new Error(`Invalid skill component: ${entryPath}. Expected a directory.`);
  }
  return true;
}

function validateSkillDirectory(skillRoot) {
  const skillFile = path.join(skillRoot, "SKILL.md");
  if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) {
    throw new Error(`Missing skill instructions: ${skillFile}`);
  }

  const metadata = parseFrontmatter(fs.readFileSync(skillFile, "utf8"), skillFile);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name || "")) {
    throw new Error(`Invalid skill name in ${skillFile}. Use kebab-case.`);
  }
  if (!metadata.description) {
    throw new Error(`Invalid skill metadata: ${skillFile}. Missing description.`);
  }

  const directoryName = path.basename(path.resolve(skillRoot));
  if (directoryName !== metadata.name) {
    throw new Error(
      `Skill name mismatch: ${metadata.name} does not match directory ${directoryName}.`,
    );
  }

  const components = Object.fromEntries(
    OPTIONAL_SKILL_DIRECTORIES.map((name) => [name, validateOptionalDirectory(skillRoot, name)]),
  );
  const openAiMetadata = path.join(skillRoot, "agents", "openai.yaml");
  if (fs.existsSync(openAiMetadata) && !fs.statSync(openAiMetadata).isFile()) {
    throw new Error(`Invalid skill metadata file: ${openAiMetadata}`);
  }

  return {
    name: metadata.name,
    description: metadata.description,
    skillFile,
    components,
    openAiMetadata: fs.existsSync(openAiMetadata),
  };
}

module.exports = {
  OPTIONAL_SKILL_DIRECTORIES,
  parseFrontmatter,
  validateSkillDirectory,
};
