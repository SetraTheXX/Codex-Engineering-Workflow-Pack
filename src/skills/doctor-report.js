"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonFile } = require("../lib/json");
const {
  MANUAL_ADAPTER,
  OPENCODE_ADAPTER,
  getAdapterAvailability,
  getAdapterCapabilities,
  getSupportedAdapterNames,
} = require("../run/adapters/registry");
const {
  ADAPTER_CONFIG_FILE,
  ADAPTER_CONFIG_ROLES,
  loadResolvedAdapterConfig,
} = require("../run/adapters/config");
const { buildProviderProfile } = require("../run/adapters/profile");
const { resolveOpenCodeModel } = require("../run/adapters/model");
const { makeBudgetEnvelope } = require("../supervise/profiles");
const { getSkillStatus, resolveTarget } = require("./paths");

const DOCTOR_REPORT_SCHEMA_VERSION = "doctor-report/v1-beta";
const packageRoot = path.resolve(__dirname, "..", "..");
const packageJson = readJsonFile(path.join(packageRoot, "package.json"), "package metadata");

function readiness(status, reason) {
  return { status, reason };
}

function buildReadiness(adapterName, profile) {
  if (adapterName === MANUAL_ADAPTER) {
    return {
      binary: readiness("not-applicable", "Manual execution does not require an external binary."),
      authentication: readiness("not-applicable", "Manual execution does not authenticate an external provider."),
      model: readiness("not-applicable", "Manual execution has no configured model."),
      appServerSchema: readiness("not-applicable", "Manual execution does not use Codex App Server."),
      hostEvents: readiness("not-applicable", "Manual execution does not observe host events."),
      appsSdk: readiness("not-applicable", "Manual execution does not require Apps SDK."),
    };
  }

  if (adapterName === OPENCODE_ADAPTER) {
    return {
      binary: readiness(profile.binaryReadiness, "Derived only from the OpenCode binary/version probe."),
      authentication: readiness("unknown", "Doctor does not inspect or modify OpenCode authentication."),
      model: readiness("unknown", "A model override is configuration, not a readiness probe."),
      appServerSchema: readiness("not-applicable", "OpenCode is not a Codex App Server backend."),
      hostEvents: readiness("not-applicable", "The experimental adapter does not observe ChatGPT host events."),
      appsSdk: readiness("not-applicable", "The experimental adapter does not expose an Apps SDK surface."),
    };
  }

  return {
    binary: readiness(profile.binaryReadiness, "Derived from the existing codex-exec binary/version probe."),
    authentication: readiness(profile.authReadiness, "Existing codex-exec adapter readiness behavior is unchanged."),
    model: readiness("not-applicable", "The selected codex-exec adapter does not claim model readiness in doctor."),
    appServerSchema: readiness("not-applicable", "codex-exec is the selected backend, not App Server."),
    hostEvents: readiness("not-applicable", "codex-exec JSONL does not expose host-owned events."),
    appsSdk: readiness("not-applicable", "codex-exec does not depend on Apps SDK."),
  };
}

function readPluginPackage() {
  const manifestPath = path.join(packageRoot, "plugins", "cewp", ".codex-plugin", "plugin.json");
  const marketplacePath = path.join(packageRoot, ".agents", "plugins", "marketplace.json");
  const manifestAvailable = fs.existsSync(manifestPath);
  const marketplaceAvailable = fs.existsSync(marketplacePath);
  const manifest = manifestAvailable ? readJsonFile(manifestPath, "CEWP plugin manifest") : null;
  return {
    package: {
      status: manifestAvailable && marketplaceAvailable ? "available" : "missing",
      manifestPath: path.relative(packageRoot, manifestPath).replace(/\\/g, "/"),
      marketplacePath: path.relative(packageRoot, marketplacePath).replace(/\\/g, "/"),
      name: manifest && manifest.name,
      version: manifest && manifest.version,
    },
    hostInstallation: readiness(
      "unknown",
      "Package presence does not prove installation or enablement in the current Codex host.",
    ),
    invocation: readiness(
      "unknown",
      "Doctor does not attach to or inspect the ChatGPT desktop host session.",
    ),
  };
}

function buildAdapterState(cwd) {
  const adapterConfig = loadResolvedAdapterConfig(cwd);
  const configuredOpenCodeModels = Array.from(new Set(
    ADAPTER_CONFIG_ROLES
      .map((role) => adapterConfig[role])
      .filter((roleConfig) => roleConfig.provider === OPENCODE_ADAPTER && roleConfig.model)
      .map((roleConfig) => roleConfig.model),
  ));
  const openCodeProfileModel = configuredOpenCodeModels.length === 1
    ? configuredOpenCodeModels[0]
    : configuredOpenCodeModels.length === 0
      ? resolveOpenCodeModel({ env: process.env })
      : null;
  const providers = getSupportedAdapterNames().map((adapterName) => {
    const availability = getAdapterAvailability(adapterName, { commandName: "doctor" });
    const capabilities = getAdapterCapabilities(adapterName, { commandName: "doctor" });
    const profile = buildProviderProfile({
      provider: adapterName,
      capabilities,
      availability,
      model: adapterName === OPENCODE_ADAPTER ? openCodeProfileModel : null,
    });
    return {
      id: adapterName,
      experimental: profile.experimental,
      configuredModel: profile.model,
      availability,
      capabilities,
      providerProfile: profile,
      readiness: buildReadiness(adapterName, profile),
    };
  });
  return {
    default: "codex-exec",
    config: {
      source: fs.existsSync(path.join(cwd, ADAPTER_CONFIG_FILE)) ? ADAPTER_CONFIG_FILE : "default",
      roles: Object.fromEntries(ADAPTER_CONFIG_ROLES.map((role) => [role, adapterConfig[role]])),
    },
    providers,
  };
}

function buildCapabilities() {
  return {
    nativeGoal: {
      installedPluginAccess: readiness(
        "unavailable",
        "No documented boundary lets this plugin attach to the host-owned desktop goal session.",
      ),
      managedAppServer: readiness(
        "experimental-not-selected",
        "A separate CEWP-owned App Server process was probed but is not the Phase 9 backend.",
      ),
      generatedGoalFallback: readiness("supported", "CEWP can present bounded goal briefs without native attachment."),
    },
    warning: {
      conversation: readiness("supported", "Structured CLI/plugin output is the minimum warning surface."),
      hook: readiness("unknown", "Doctor does not probe the current host hook installation."),
      appsSdk: readiness("unknown", "No CEWP Apps SDK component is shipped or inferred."),
      desktopNotification: readiness("unknown", "Desktop notification delivery is host-owned and not probed."),
      coreEnforcement: {
        status: "supported",
        dependsOnPresentation: false,
        reason: "CEWP Core gates remain authoritative when optional warning surfaces are missing.",
      },
    },
    hostUsage: {
      perRunTokens: readiness("unknown", "The selected plugin path exposes no documented host per-run usage feed."),
      rateLimits: readiness("unknown", "No version-tested host rate-limit observation is active in doctor."),
      credits: readiness("unknown", "No supported credit balance source is active in doctor."),
      accountUsage: readiness("unknown", "Account activity is not inferred from schema presence."),
      source: null,
      observedAt: null,
    },
  };
}

function buildAssuranceDefault() {
  const budget = makeBudgetEnvelope("standard");
  return {
    profile: "standard",
    mode: "supervised",
    testAuthoring: "auto",
    maxConcurrentWorkers: budget.maxConcurrentWorkers,
    maxRepairsPerCheckpoint: budget.maxRepairsPerCheckpoint,
    modelOperations: budget.modelOperations,
    protectedAllocations: budget.protectedAllocations,
    thresholds: budget.thresholds,
  };
}

function buildRemediations({ missingSkills, plugin, adapters }) {
  const items = [];
  if (missingSkills.length > 0) {
    items.push({
      code: "reinstall-skills",
      severity: "error",
      message: `Reinstall missing skills: ${missingSkills.map((entry) => entry.skill).join(", ")}.`,
      command: "cewp init --force",
    });
  }
  if (plugin.package.status !== "available") {
    items.push({
      code: "restore-plugin-package",
      severity: "error",
      message: "Reinstall CEWP so the plugin manifest and local marketplace entry are present.",
      command: "npm install @setrathex/codex-engineering-workflow-pack",
    });
  }
  for (const provider of adapters.providers) {
    if (provider.availability.remediation) {
      items.push({
        code: `provider-${provider.id}-availability`,
        severity: provider.id === OPENCODE_ADAPTER ? "warning" : "error",
        provider: provider.id,
        message: provider.availability.remediation,
        command: null,
      });
    }
  }
  items.push({
    code: "verify-plugin-host-installation",
    severity: "info",
    message: "Use Codex plugin list commands to verify CEWP installation and enablement in the intended host.",
    command: "codex plugin list --json",
  });
  return items;
}

function buildDoctorReport(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const targetRoot = resolveTarget(options);
  const skillItems = getSkillStatus(targetRoot);
  const missingSkills = skillItems.filter((entry) => !entry.hasDirectory || !entry.hasSkillFile);
  const plugin = readPluginPackage();
  const adapters = buildAdapterState(cwd);
  const status = missingSkills.length === 0 && plugin.package.status === "available" ? "pass" : "fail";
  return {
    schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    mode: options.mode,
    target: targetRoot,
    runtime: {
      package: { name: packageJson.name, version: packageJson.version },
      node: { version: process.version, required: packageJson.engines.node },
      platform: process.platform,
      arch: process.arch,
    },
    skills: {
      status: missingSkills.length === 0 ? "available" : "incomplete",
      expected: skillItems.length,
      installed: skillItems.length - missingSkills.length,
      items: skillItems,
    },
    plugin,
    capabilities: buildCapabilities(),
    execution: {
      owner: "managed",
      backend: "codex-exec",
      adapter: "codex-exec",
      worktreeOwner: "cewp-core",
      ownerCount: 1,
      backendCount: 1,
    },
    adapters,
    assuranceDefault: buildAssuranceDefault(),
    remediations: buildRemediations({ missingSkills, plugin, adapters }),
  };
}

function buildDoctorFailureReport(options, error) {
  return {
    schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: "fail",
    mode: options.mode,
    target: options.target ? path.resolve(options.target) : null,
    runtime: {
      package: { name: packageJson.name, version: packageJson.version },
      node: { version: process.version, required: packageJson.engines.node },
      platform: process.platform,
      arch: process.arch,
    },
    error: {
      code: "doctor-setup-failed",
      message: error.message,
    },
    remediations: [{
      code: "inspect-doctor-input",
      severity: "error",
      message: `${error.message} Verify --mode/--target, then run cewp init for the intended repository.`,
      command: "cewp init",
    }],
  };
}

module.exports = {
  DOCTOR_REPORT_SCHEMA_VERSION,
  buildDoctorFailureReport,
  buildDoctorReport,
};
