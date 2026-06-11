"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJsonFile } = require("../../lib/json");
const { CODEX_EXEC_ADAPTER, validateAdapterName } = require("./registry");

const ADAPTER_CONFIG_ROLES = ["manager", "worker-a", "worker-b", "reviewer"];
const ADAPTER_CONFIG_FILE = "cewp.config.json";

function defaultAdapterConfig() {
  return Object.fromEntries(
    ADAPTER_CONFIG_ROLES.map((role) => [
      role,
      { provider: CODEX_EXEC_ADAPTER },
    ]),
  );
}

function normalizeRoleConfig(role, roleConfig = {}) {
  const provider = roleConfig.provider || CODEX_EXEC_ADAPTER;
  validateAdapterName(provider, { commandName: "adapter config" });
  return { provider };
}

function normalizeAdapterConfig(config = {}) {
  const roles = config.roles || {};
  const unknownRoles = Object.keys(roles).filter(
    (role) => !ADAPTER_CONFIG_ROLES.includes(role),
  );

  if (unknownRoles.length > 0) {
    throw new Error(
      `Unknown adapter config role: ${unknownRoles[0]}. Supported roles: ${ADAPTER_CONFIG_ROLES.join(", ")}.`,
    );
  }

  const normalized = defaultAdapterConfig();
  for (const role of ADAPTER_CONFIG_ROLES) {
    normalized[role] = normalizeRoleConfig(role, roles[role]);
  }

  return normalized;
}

function getAdapterConfigFilePath(repoRoot) {
  return path.join(repoRoot || process.cwd(), ADAPTER_CONFIG_FILE);
}

function readAdapterConfigFile(repoRoot) {
  const configPath = getAdapterConfigFilePath(repoRoot);

  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  return readJsonFile(configPath, ADAPTER_CONFIG_FILE);
}

function getAdaptersConfig(configFile, configPath) {
  if (
    !configFile ||
    typeof configFile !== "object" ||
    Array.isArray(configFile)
  ) {
    throw new Error(
      `Invalid ${ADAPTER_CONFIG_FILE}: ${configPath}. Expected a JSON object.`,
    );
  }

  if (configFile.adapters === undefined) {
    return {};
  }

  if (
    !configFile.adapters ||
    typeof configFile.adapters !== "object" ||
    Array.isArray(configFile.adapters)
  ) {
    throw new Error(
      `Invalid ${ADAPTER_CONFIG_FILE} adapters: ${configPath}. Expected an object.`,
    );
  }

  return configFile.adapters;
}

function loadAdapterConfig(repoRoot) {
  const configPath = getAdapterConfigFilePath(repoRoot);
  const configFile = readAdapterConfigFile(repoRoot);

  if (!configFile) {
    return normalizeAdapterConfig();
  }

  return normalizeAdapterConfig({
    roles: getAdaptersConfig(configFile, configPath),
  });
}

function assertKnownRole(role) {
  if (!ADAPTER_CONFIG_ROLES.includes(role)) {
    throw new Error(
      `Unknown adapter config role: ${role}. Supported roles: ${ADAPTER_CONFIG_ROLES.join(", ")}.`,
    );
  }
}

function resolveAdapterProviderForRole({
  role,
  adapterName,
  config,
  repoRoot,
  commandName = "dispatch exec",
} = {}) {
  assertKnownRole(role);

  if (adapterName) {
    validateAdapterName(adapterName, { commandName });
  }

  const configPath = getAdapterConfigFilePath(repoRoot);
  const configFile = readAdapterConfigFile(repoRoot);
  const fileRoles = configFile ? getAdaptersConfig(configFile, configPath) : {};
  const roles = {
    ...fileRoles,
    ...((config && config.roles) || {}),
  };

  if (adapterName) {
    roles[role] = {
      ...(roles[role] || {}),
      provider: adapterName,
    };
  }

  return normalizeAdapterConfig({ ...config, roles })[role].provider;
}

module.exports = {
  ADAPTER_CONFIG_FILE,
  ADAPTER_CONFIG_ROLES,
  defaultAdapterConfig,
  loadAdapterConfig,
  normalizeAdapterConfig,
  readAdapterConfigFile,
  resolveAdapterProviderForRole,
};
