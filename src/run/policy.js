"use strict";

const fs = require("node:fs");
const path = require("node:path");

const POLICY_MODES = ["safe", "trusted", "full-authority"];

function getPolicyPath(repoRoot = process.cwd()) {
  return path.join(repoRoot, ".cewp", "policy.json");
}

function getPolicyTemplate(mode) {
  if (!POLICY_MODES.includes(mode)) {
    throw new Error(`Unsupported policy mode: ${mode}. Supported modes: ${POLICY_MODES.join(", ")}.`);
  }

  const base = {
    schemaVersion: 1,
    mode,
    updatedAt: new Date().toISOString(),
    authority: {
      editFiles: false,
      runCommands: false,
      runCewpPipeline: false,
      runWorkers: false,
      runReviewer: false,
      finalize: false,
      cleanup: false,
      commit: false,
      push: false,
      publish: false,
      release: false,
    },
    notes: [
      "Safe mode is the default.",
      "Push, publish, and release require explicit policy permission.",
    ],
  };

  if (mode === "trusted") {
    return {
      ...base,
      authority: {
        ...base.authority,
        editFiles: true,
        runCommands: true,
        runCewpPipeline: true,
      },
      notes: [
        "Trusted mode allows non-destructive CEWP steps with fewer repeated approvals.",
        "Finalize, cleanup, commit, push, publish, and release still require explicit approval unless policy allows them later.",
      ],
    };
  }

  if (mode === "full-authority") {
    return {
      ...base,
      authority: {
        ...base.authority,
        editFiles: true,
        runCommands: true,
        runCewpPipeline: true,
        runWorkers: true,
        runReviewer: true,
        finalize: true,
        cleanup: true,
        commit: true,
      },
      notes: [
        "Full authority is a supported advanced mode for experienced users.",
        "Full authority does not disable CEWP guardrails.",
        "Push, publish, and release remain disabled unless explicitly enabled by policy later.",
      ],
    };
  }

  return base;
}

function readPolicy(repoRoot = process.cwd()) {
  const policyPath = getPolicyPath(repoRoot);

  if (!fs.existsSync(policyPath)) {
    return {
      policy: getPolicyTemplate("safe"),
      policyPath,
      isDefault: true,
    };
  }

  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid CEWP policy JSON: ${policyPath}. ${error.message}`);
  }

  if (!policy || policy.schemaVersion !== 1 || !POLICY_MODES.includes(policy.mode)) {
    throw new Error(`Invalid CEWP policy file: ${policyPath}. Expected schemaVersion 1 and mode safe|trusted|full-authority.`);
  }

  return {
    policy,
    policyPath,
    isDefault: false,
  };
}

function writePolicy(mode, repoRoot = process.cwd()) {
  const policyPath = getPolicyPath(repoRoot);
  const policy = getPolicyTemplate(mode);
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  return { policy, policyPath };
}

function printPolicy({ policy, policyPath, isDefault }) {
  console.log("CEWP Operator Policy");
  console.log(`Mode: ${policy.mode}${isDefault ? " (default)" : ""}`);
  console.log(`Path: ${policyPath}`);
  console.log("");
  console.log("Authority:");
  for (const [key, value] of Object.entries(policy.authority || {})) {
    console.log(`  ${key}: ${value ? "yes" : "no"}`);
  }
  console.log("");
  console.log("Notes:");
  for (const note of policy.notes || []) {
    console.log(`  - ${note}`);
  }
}

function runPolicy(options = {}) {
  if (options.subcommand === "show" || !options.subcommand) {
    printPolicy(readPolicy());
    return;
  }

  if (options.subcommand === "set") {
    const mode = options.policyMode;
    if (!mode) {
      throw new Error(`cewp policy set requires a mode: ${POLICY_MODES.join(", ")}.`);
    }
    const result = writePolicy(mode);
    console.log("CEWP Operator Policy updated");
    console.log(`Mode: ${result.policy.mode}`);
    console.log(`Path: ${result.policyPath}`);
    if (mode === "full-authority") {
      console.log("");
      console.log("Full authority is a supported advanced mode for experienced users.");
      console.log("CEWP guardrails remain active: worktrees, scope checks, reviewer decision, logs, and reports.");
      console.log("Push, publish, and release remain disabled unless explicitly enabled by policy later.");
    }
    return;
  }

  if (options.subcommand === "reset") {
    const result = writePolicy("safe");
    console.log("CEWP Operator Policy reset");
    console.log("Mode: safe");
    console.log(`Path: ${result.policyPath}`);
    return;
  }

  throw new Error(`Unsupported policy command: ${options.subcommand}`);
}

module.exports = {
  getPolicyPath,
  getPolicyTemplate,
  readPolicy,
  writePolicy,
  runPolicy,
};
