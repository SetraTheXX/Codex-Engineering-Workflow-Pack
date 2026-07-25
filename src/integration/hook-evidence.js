"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadWorkflowRun } = require("../workflow/state");
const { writeJsonAtomic } = require("../workflow/state");

const CODEX_HOOK_TRUST_SCHEMA_VERSION = "codex-hook-trust/v1";
const CODEX_HOOK_CONTRACT_VERSION = "codex-hooks-doc/2026-07-22";
const HOOK_BUNDLE_FILES = Object.freeze([
  "hooks/hooks.json",
  "hooks/capture-subagent.js",
]);
const SUBAGENT_HOOK_EVIDENCE_SCHEMA_VERSION = "subagent-hook-evidence/v1";
const SUBAGENT_HOOK_EVENTS = Object.freeze({
  SubagentStart: "subagent-started",
  SubagentStop: "subagent-stopped",
});

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function pluginRoot() {
  if (process.env.PLUGIN_ROOT) return path.resolve(process.env.PLUGIN_ROOT);
  return path.resolve(__dirname, "..", "..", "plugins", "cewp");
}

function inspectHookBundle(root = pluginRoot()) {
  const files = HOOK_BUNDLE_FILES.map((relativePath) => {
    const filePath = path.join(root, ...relativePath.split("/"));
    if (!fs.existsSync(filePath)) throw new Error(`Codex hook bundle file is missing: ${relativePath}.`);
    const content = fs.readFileSync(filePath);
    return { path: relativePath, digest: sha256(content), content };
  });
  const bundle = Buffer.concat(files.flatMap((file) => [
    Buffer.from(`${file.path}\0`, "utf8"),
    file.content,
    Buffer.from("\0", "utf8"),
  ]));
  return {
    digest: sha256(bundle),
    files: files.map(({ path: relativePath, digest }) => ({ path: relativePath, digest })),
  };
}

function detectCodexVersion(options = {}) {
  if (process.env.CEWP_HOOK_CODEX_VERSION) return process.env.CEWP_HOOK_CODEX_VERSION.trim();
  const command = options.command || "codex";
  const result = childProcess.spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) {
    throw new Error("Codex hook approval requires a successful local `codex --version` probe.");
  }
  return String(result.stdout).trim();
}

function detectCewpVersion() {
  const packagePath = path.resolve(__dirname, "..", "..", "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new Error("Codex hook evidence requires the complete CEWP package, including package.json.");
  }
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("Codex hook evidence could not determine the CEWP runtime version.");
  }
  return packageJson.version.trim();
}

function trustPath(found) {
  return path.join(found.runRoot, "integration", "codex-hook-trust.json");
}

function activationPath(repoRoot) {
  return path.join(repoRoot, ".cewp", "integration", "active-hook-trust.json");
}

function boundedText(value, label, maximum, optional = false) {
  if (optional && (value === null || value === undefined)) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid Codex subagent hook event: ${label} is required.`);
  }
  const text = value.trim();
  if (text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new Error(`Invalid Codex subagent hook event: ${label} is too long or contains control characters.`);
  }
  return text;
}

function findActivatedRepoRoot(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(activationPath(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function validateActiveTrust(repoRoot, currentCodexVersion, root = pluginRoot(), currentCewpVersion) {
  const activePath = activationPath(repoRoot);
  if (!fs.existsSync(activePath)) return null;
  const active = JSON.parse(fs.readFileSync(activePath, "utf8"));
  if (active.schemaVersion !== "codex-hook-activation/v1") {
    throw new Error("Codex hook evidence activation is malformed; approve the hook bundle again.");
  }
  const found = loadWorkflowRun(repoRoot, active.runId);
  const filePath = trustPath(found);
  if (!fs.existsSync(filePath)) throw new Error("Codex hook trust receipt is missing; approve the hook bundle again.");
  const trust = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (trust.schemaVersion !== CODEX_HOOK_TRUST_SCHEMA_VERSION || trust.provider !== "codex") {
    throw new Error("Codex hook trust receipt is malformed; approve the hook bundle again.");
  }
  const selection = {
    runId: trust.runId,
    workflowRevision: trust.workflowRevision,
    workflowDigest: trust.workflowDigest,
    cewpVersion: trust.cewpVersion,
    codexVersion: trust.codexVersion,
    hookContractVersion: trust.hookContractVersion,
    bundleDigest: trust.bundleDigest,
  };
  const approvalDigest = sha256(JSON.stringify(selection));
  if (
    !trust.approval
    || trust.approval.kind !== "operator"
    || trust.approval.digest !== approvalDigest
    || active.trustDigest !== approvalDigest
  ) {
    throw new Error("Codex hook trust approval digest changed; review and approve the hook bundle again.");
  }
  const currentBundle = inspectHookBundle(root);
  if (trust.bundleDigest !== currentBundle.digest) {
    throw new Error("Codex hook definition drift detected; review and approve the current bundle again.");
  }
  if (trust.codexVersion !== currentCodexVersion) {
    throw new Error(`Codex hook version drift detected: approved ${trust.codexVersion}, observed ${currentCodexVersion}.`);
  }
  const observedCewpVersion = currentCewpVersion || detectCewpVersion();
  if (trust.cewpVersion !== observedCewpVersion) {
    throw new Error(`CEWP hook runtime drift detected: approved ${trust.cewpVersion}, observed ${observedCewpVersion}.`);
  }
  if (trust.hookContractVersion !== CODEX_HOOK_CONTRACT_VERSION) {
    throw new Error("Codex hook contract drift detected; review and approve the current contract again.");
  }
  if (
    trust.runId !== found.run.runId
    || trust.workflowRevision !== found.run.workflow.revision
    || trust.workflowDigest !== found.run.workflow.digest
  ) {
    throw new Error("Codex hook trust is stale for the current workflow revision.");
  }
  return { active, found, trust };
}

function recordSubagentHookEvent(options = {}) {
  const input = options.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid Codex subagent hook event: expected one JSON object.");
  }
  const eventCwd = boundedText(input.cwd, "cwd", 4096);
  const repoRoot = findActivatedRepoRoot(options.repoRoot || eventCwd);
  if (!repoRoot) return { recorded: false, reason: "not-activated" };
  const resolvedCwd = path.resolve(eventCwd);
  const relativeCwd = path.relative(repoRoot, resolvedCwd);
  if (relativeCwd.startsWith("..") || path.isAbsolute(relativeCwd)) {
    throw new Error("Invalid Codex subagent hook event: cwd is outside the activated repository.");
  }
  const currentCodexVersion = options.codexVersion || detectCodexVersion(options);
  const active = validateActiveTrust(repoRoot, currentCodexVersion, options.pluginRoot, options.cewpVersion);
  if (!active) return { recorded: false, reason: "not-activated" };
  const hookEventName = boundedText(input.hook_event_name, "hook_event_name", 64);
  const type = SUBAGENT_HOOK_EVENTS[hookEventName];
  if (!type) throw new Error(`Invalid Codex subagent hook event: unsupported event ${hookEventName}.`);
  const agentId = boundedText(input.agent_id, "agent_id", 512);
  const parentSessionId = boundedText(input.session_id, "session_id", 512);
  const parentTurnId = boundedText(input.turn_id, "turn_id", 512);
  const agentType = boundedText(input.agent_type, "agent_type", 128);
  const model = boundedText(input.model, "model", 256);
  const permissionMode = boundedText(input.permission_mode, "permission_mode", 64);
  const summaryValue = hookEventName === "SubagentStop"
    ? boundedText(input.last_assistant_message, "last_assistant_message", 4000, true)
    : null;
  const observedAt = (options.now || new Date()).toISOString();
  const evidence = {
    schemaVersion: SUBAGENT_HOOK_EVIDENCE_SCHEMA_VERSION,
    eventId: sha256(JSON.stringify({
      runId: active.found.run.runId,
      hookEventName,
      parentSessionId,
      parentTurnId,
      agentId,
      observedAt,
    })),
    type,
    observedAt,
    workflow: {
      runId: active.found.run.runId,
      revision: active.found.run.workflow.revision,
      digest: active.found.run.workflow.digest,
    },
    source: {
      path: "plugin-hook",
      evidenceClass: "observed",
      codexVersion: currentCodexVersion,
      cewpVersion: active.trust.cewpVersion,
      hookContractVersion: CODEX_HOOK_CONTRACT_VERSION,
      bundleDigest: active.trust.bundleDigest,
      trustApprovalDigest: active.trust.approval.digest,
    },
    references: {
      agentId,
      agentType,
      parentSessionId,
      parentTurnId,
      agentThreadId: { status: "unknown", value: null, reason: "not-exposed-by-documented-hook-input" },
    },
    context: {
      model,
      permissionMode,
      workingDirectory: path.relative(repoRoot, resolvedCwd).replace(/\\/g, "/") || ".",
    },
    summary: summaryValue
      ? { status: "observed", value: summaryValue }
      : { status: "unknown", value: null },
    claims: {
      coreEnforcement: false,
      opensCoreGates: false,
      transcriptRead: false,
    },
  };
  const ledgerPath = path.join(active.found.runRoot, "integration", "subagent-hook-evidence.jsonl");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(evidence)}\n`);
  return { recorded: true, evidence };
}

function approveCodexHookTrust(options = {}) {
  if (!options.yes) {
    throw new Error("Codex hook evidence requires explicit operator approval with --yes after reviewing the bundle and `/hooks`.");
  }
  const found = loadWorkflowRun(options.repoRoot || process.cwd(), options.runId);
  const bundle = inspectHookBundle(options.pluginRoot);
  const codexVersion = options.codexVersion || detectCodexVersion(options);
  const approvedAt = (options.now || new Date()).toISOString();
  const selection = {
    runId: found.run.runId,
    workflowRevision: found.run.workflow.revision,
    workflowDigest: found.run.workflow.digest,
    cewpVersion: options.cewpVersion || detectCewpVersion(),
    codexVersion,
    hookContractVersion: CODEX_HOOK_CONTRACT_VERSION,
    bundleDigest: bundle.digest,
  };
  const trust = {
    schemaVersion: CODEX_HOOK_TRUST_SCHEMA_VERSION,
    provider: "codex",
    ...selection,
    bundleFiles: bundle.files,
    approvedAt,
    approval: {
      kind: "operator",
      digest: sha256(JSON.stringify(selection)),
    },
    hostTrust: {
      required: true,
      status: "pending-review",
      reviewCommand: "/hooks",
    },
    provenance: {
      source: "official-documentation",
      url: "https://learn.chatgpt.com/docs/hooks",
    },
    claims: {
      coreEnforcement: false,
      opensCoreGates: false,
      transcriptRead: false,
    },
  };
  const filePath = trustPath(found);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, trust);
  const activePath = activationPath(found.repoRoot);
  fs.mkdirSync(path.dirname(activePath), { recursive: true });
  writeJsonAtomic(activePath, {
    schemaVersion: "codex-hook-activation/v1",
    runId: found.run.runId,
    trustDigest: trust.approval.digest,
    activatedAt: approvedAt,
  });
  fs.appendFileSync(path.join(found.runRoot, "events.jsonl"), `${JSON.stringify({
    schemaVersion: "workflow-event/v1",
    timestamp: approvedAt,
    type: "hook-evidence-approved",
    runId: found.run.runId,
    revision: found.run.workflow.revision,
    actor: "operator",
    approvalDigest: trust.approval.digest,
  })}\n`);
  return {
    trust,
    nextAction: {
      kind: "host-hook-review",
      command: "/hooks",
      reason: "Codex separately reviews and trusts the exact current plugin hook definition.",
    },
  };
}

function classifyCompatibilityWarning(error) {
  const message = error && error.message ? error.message : String(error);
  const code = /Codex hook version drift/.test(message)
    ? "codex-version-drift"
    : /definition drift/.test(message)
      ? "hook-definition-drift"
      : /runtime drift/.test(message)
        ? "cewp-version-drift"
        : /contract drift/.test(message)
          ? "hook-contract-drift"
          : /workflow revision|not active/.test(message)
            ? "workflow-binding-drift"
            : /approval digest|trust receipt/.test(message)
              ? "hook-trust-change"
              : "hook-evidence-unavailable";
  return { code, message };
}

function inspectCodexHookTrust(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const found = loadWorkflowRun(repoRoot, options.runId);
  const filePath = trustPath(found);
  const claims = {
    coreEnforcement: false,
    opensCoreGates: false,
    hostTrustInferred: false,
  };
  if (!fs.existsSync(filePath)) {
    return {
      schemaVersion: "codex-hook-status/v1",
      runId: found.run.runId,
      compatible: false,
      active: false,
      trust: null,
      warnings: [{ code: "hook-evidence-not-approved", message: "No approved hook evidence bundle exists for this run." }],
      fallback: "core-and-conversation-only",
      claims,
    };
  }
  let trust = null;
  try {
    try {
      trust = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`Codex hook trust receipt is malformed: ${error.message}`);
    }
    const currentCodexVersion = options.codexVersion || detectCodexVersion(options);
    const active = validateActiveTrust(repoRoot, currentCodexVersion, options.pluginRoot, options.cewpVersion);
    if (!active || active.found.run.runId !== found.run.runId) {
      throw new Error("Codex hook trust is not active for the requested workflow run.");
    }
    return {
      schemaVersion: "codex-hook-status/v1",
      runId: found.run.runId,
      compatible: true,
      active: true,
      trust,
      warnings: [],
      fallback: null,
      claims,
    };
  } catch (error) {
    return {
      schemaVersion: "codex-hook-status/v1",
      runId: found.run.runId,
      compatible: false,
      active: false,
      trust,
      warnings: [classifyCompatibilityWarning(error)],
      fallback: "core-and-conversation-only",
      claims,
    };
  }
}

module.exports = {
  CODEX_HOOK_CONTRACT_VERSION,
  CODEX_HOOK_TRUST_SCHEMA_VERSION,
  SUBAGENT_HOOK_EVIDENCE_SCHEMA_VERSION,
  approveCodexHookTrust,
  detectCewpVersion,
  detectCodexVersion,
  findActivatedRepoRoot,
  inspectCodexHookTrust,
  inspectHookBundle,
  recordSubagentHookEvent,
  validateActiveTrust,
};
