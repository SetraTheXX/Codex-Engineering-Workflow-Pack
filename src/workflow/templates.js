"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  digestWorkflowDefinition,
  validateWorkflowDefinition,
} = require("./definition");

const WORKFLOW_TEMPLATES = Object.freeze([
  {
    name: "guarded-change",
    description: "One bounded implementation checkpoint with focused and full verification.",
  },
  {
    name: "migration",
    description: "A reversible preparation and application sequence with recovery evidence.",
  },
  {
    name: "review-only",
    description: "An audit-only evidence review that claims no managed execution backend.",
  },
]);

function listWorkflowTemplates() {
  return WORKFLOW_TEMPLATES.map((template) => ({ ...template }));
}

function loadWorkflowTemplate(name) {
  const metadata = WORKFLOW_TEMPLATES.find((template) => template.name === name);
  if (!metadata) {
    throw new Error(`Unsupported workflow template: ${name || "missing"}. Expected ${WORKFLOW_TEMPLATES.map((entry) => entry.name).join(", ")}.`);
  }
  const templatePath = path.join(__dirname, "..", "..", "templates", "workflows", `${name}.json`);
  const definition = validateWorkflowDefinition(JSON.parse(fs.readFileSync(templatePath, "utf8")));
  return {
    ...metadata,
    definition,
    digest: digestWorkflowDefinition(definition),
  };
}

module.exports = {
  WORKFLOW_TEMPLATES,
  listWorkflowTemplates,
  loadWorkflowTemplate,
};
