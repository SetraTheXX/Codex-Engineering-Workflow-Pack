"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  digestWorkflowDefinition,
  validateWorkflowDefinition,
} = require("./definition");

function isInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readDefinition(repoRoot, definitionFile) {
  if (!definitionFile) throw new Error("workflow validate requires a repository-relative JSON file.");
  const resolved = path.resolve(repoRoot, definitionFile);
  if (!isInside(repoRoot, resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Workflow definition must be a file inside the repository: ${definitionFile}.`);
  }
  const realRoot = fs.realpathSync(repoRoot);
  const realFile = fs.realpathSync(resolved);
  if (!isInside(realRoot, realFile)) {
    throw new Error(`Workflow definition must resolve inside the repository: ${definitionFile}.`);
  }
  const content = fs.readFileSync(realFile);
  if (content.length > 1024 * 1024) throw new Error("Workflow definition exceeds 1 MiB.");
  try {
    return JSON.parse(content.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid workflow definition JSON: ${error.message}`);
  }
}

function outputJson(command, data) {
  console.log(JSON.stringify({
    schemaVersion: "operator-json/v1",
    command,
    generatedAt: new Date().toISOString(),
    data,
    warnings: [],
  }, null, 2));
}

function runWorkflow(options = {}) {
  if (options.subcommand !== "validate") {
    throw new Error(`Unsupported workflow command: ${options.subcommand || "missing"}.`);
  }
  const definition = validateWorkflowDefinition(readDefinition(process.cwd(), options.definitionFile));
  const result = {
    definition,
    digest: digestWorkflowDefinition(definition),
  };
  if (options.json) {
    outputJson("workflow.validate", result);
  } else {
    console.log("CEWP workflow definition valid");
    console.log(`Workflow: ${definition.workflowId}`);
    console.log(`Revision: ${definition.revision.number}`);
    console.log(`Tasks: ${definition.tasks.length}`);
    console.log(`Digest: ${result.digest}`);
  }
}

module.exports = {
  runWorkflow,
};
