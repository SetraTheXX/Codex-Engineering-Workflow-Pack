"use strict";

const {
  approveSupervisedRun,
  createProposedRun,
  inspectSupervisedRun,
} = require("../supervise/state");
const { retrySupervisedCheckpoint } = require("../supervise/execution");
const { verifySupervisedCheckpoint } = require("../supervise/verification");
const { finalizeSupervisedRun } = require("../supervise/receipt");
const { runSupervisedControl } = require("../supervise/controls");

const stringArray = { type: "array", items: { type: "string" } };
const runId = { type: "string", minLength: 1, description: "CEWP supervised run ID." };
const confirm = {
  type: "boolean",
  description: "Explicit operator confirmation after reviewing the relevant CEWP evidence.",
};

function objectSchema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const TOOLS = [
  {
    name: "cewp_create",
    title: "Create CEWP run",
    description: "Create a proposed bounded supervised run in the current repository. Does not approve or execute it.",
    inputSchema: objectSchema({
      goal: { type: "string", minLength: 1 },
      scopes: stringArray,
      verificationCommands: stringArray,
      fullVerificationCommands: stringArray,
      stoppingConditions: stringArray,
      assurance: { type: "string", enum: ["prototype", "standard", "critical"] },
      testAuthoring: { type: "string", enum: ["auto", "ask", "never"] },
    }, ["goal", "scopes", "verificationCommands", "stoppingConditions"]),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "cewp_inspect",
    title: "Inspect CEWP run",
    description: "Inspect canonical state and the next allowed action, refreshing the derived progress file.",
    inputSchema: objectSchema({ runId }, ["runId"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "cewp_approve",
    title: "Approve CEWP run",
    description: "Approve the current proposed plan revision after explicit operator confirmation. Does not execute it.",
    inputSchema: objectSchema({ runId, confirm, allowTestAuthoring: { type: "boolean" } }, ["runId", "confirm"]),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "cewp_continue",
    title: "Continue CEWP run",
    description: "Record operator continuation only after the Core confirms a verified checkpoint.",
    inputSchema: objectSchema({ runId }, ["runId"]),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "cewp_retry",
    title: "Retry CEWP checkpoint",
    description: "Dispatch one bounded managed repair, subject to ownership, policy, effort, scope, and budget gates.",
    inputSchema: objectSchema({ runId, confirm, timeoutSeconds: { type: "integer", minimum: 1 } }, ["runId", "confirm"]),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "cewp_revise",
    title: "Revise CEWP plan",
    description: "Revise an allowed unstarted or completed checkpoint and invalidate prior approval as required by Core.",
    inputSchema: objectSchema({
      runId,
      goal: { type: "string", minLength: 1 },
      scopes: stringArray,
      verificationCommands: stringArray,
      fullVerificationCommands: stringArray,
      stoppingConditions: stringArray,
    }, ["runId"]),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "cewp_verify",
    title: "Verify CEWP checkpoint",
    description: "Run the approved verification schedule in the managed worktree under Core policy and budget gates.",
    inputSchema: objectSchema({ runId, timeoutSeconds: { type: "integer", minimum: 1 } }, ["runId"]),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "cewp_finalize",
    title: "Finalize CEWP run",
    description: "Finalize only after receipt preview, verified evidence, current worktree gates, and independent reviewer PASS.",
    inputSchema: objectSchema({ runId, confirm }, ["runId", "confirm"]),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

const definitions = new Map(TOOLS.map((tool) => [tool.name, tool]));

function validateArguments(name, args) {
  const definition = definitions.get(name);
  if (!definition) {
    const error = new Error(`Unknown tool: ${name}`);
    error.code = -32602;
    throw error;
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    const error = new Error(`Tool ${name} arguments must be an object.`);
    error.code = -32602;
    throw error;
  }
  const allowed = new Set(Object.keys(definition.inputSchema.properties));
  const unknown = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    const error = new Error(`Tool ${name} received unknown arguments: ${unknown.join(", ")}.`);
    error.code = -32602;
    throw error;
  }
  for (const required of definition.inputSchema.required || []) {
    if (!(required in args)) {
      const error = new Error(`Tool ${name} requires argument ${required}.`);
      error.code = -32602;
      throw error;
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const schema = definition.inputSchema.properties[key];
    const valid = schema.type === "array"
      ? Array.isArray(value) && value.every((entry) => typeof entry === "string")
      : schema.type === "string"
        ? typeof value === "string" && (!schema.minLength || value.length >= schema.minLength)
        : schema.type === "boolean"
          ? typeof value === "boolean"
          : schema.type === "integer"
            ? Number.isInteger(value) && (!schema.minimum || value >= schema.minimum)
            : true;
    if (!valid || (schema.enum && !schema.enum.includes(value))) {
      const error = new Error(`Tool ${name} argument ${key} does not match its input schema.`);
      error.code = -32602;
      throw error;
    }
  }
}

function requireConfirmation(name, args) {
  if (args.confirm !== true) {
    throw new Error(`${name} requires explicit confirmation after reviewing CEWP state and evidence.`);
  }
}

function coreOptions(repoRoot, args) {
  return {
    ...args,
    repoRoot,
    scopes: Array.isArray(args.scopes) ? args.scopes : [],
    verificationCommands: Array.isArray(args.verificationCommands) ? args.verificationCommands : [],
    fullVerificationCommands: Array.isArray(args.fullVerificationCommands) ? args.fullVerificationCommands : [],
    stoppingConditions: Array.isArray(args.stoppingConditions) ? args.stoppingConditions : [],
  };
}

function callTool(name, args, options = {}) {
  validateArguments(name, args);
  const repoRoot = options.repoRoot || process.cwd();
  const core = coreOptions(repoRoot, args);
  if (name === "cewp_create") return createProposedRun(core);
  if (name === "cewp_inspect") return inspectSupervisedRun(core);
  if (name === "cewp_approve") {
    requireConfirmation("approve", args);
    return approveSupervisedRun({ ...core, yes: true });
  }
  if (name === "cewp_continue") {
    return runSupervisedControl({ ...core, subcommand: "continue" });
  }
  if (name === "cewp_retry") {
    requireConfirmation("retry", args);
    return retrySupervisedCheckpoint({ ...core, yes: true });
  }
  if (name === "cewp_revise") return runSupervisedControl({ ...core, subcommand: "revise" });
  if (name === "cewp_verify") return verifySupervisedCheckpoint(core);
  if (name === "cewp_finalize") {
    requireConfirmation("finalize", args);
    return finalizeSupervisedRun({ ...core, yes: true });
  }
  throw new Error(`Unknown tool: ${name}`);
}

module.exports = { TOOLS, callTool };
