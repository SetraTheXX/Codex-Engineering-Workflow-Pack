"use strict";

const { CODEX_EXEC_ADAPTER, validateAdapterName } = require("./registry");

const ADAPTER_CONFIG_ROLES = ["manager", "worker-a", "worker-b", "reviewer"];

function defaultAdapterConfig() {
  return Object.fromEntries(
    ADAPTER_CONFIG_ROLES.map((role) => [role, { provider: CODEX_EXEC_ADAPTER }])
  );
}

function normalizeRoleConfig(role, roleConfig = {}) {
  const provider = roleConfig.provider || CODEX_EXEC_ADAPTER;
  validateAdapterName(provider, { commandName: "adapter config" });
  return { provider };
}

function normalizeAdapterConfig(config = {}) {
  const roles = config.roles || {};
  const unknownRoles = Object.keys(roles).filter((role) => !ADAPTER_CONFIG_ROLES.includes(role));

  if (unknownRoles.length > 0) {
    throw new Error(`Unknown adapter config role: ${unknownRoles[0]}. Supported roles: ${ADAPTER_CONFIG_ROLES.join(", ")}.`);
  }

  const normalized = defaultAdapterConfig();
  for (const role of ADAPTER_CONFIG_ROLES) {
    normalized[role] = normalizeRoleConfig(role, roles[role]);
  }

  return normalized;
}

function assertKnownRole(role) {
  if (!ADAPTER_CONFIG_ROLES.includes(role)) {
    throw new Error(`Unknown adapter config role: ${role}. Supported roles: ${ADAPTER_CONFIG_ROLES.join(", ")}.`);
  }
}

function resolveAdapterProviderForRole({
  role,
  adapterName,
  config,
  commandName = "dispatch exec",
  requireAdapter = false,
} = {}) {
  assertKnownRole(role);

  if (requireAdapter || adapterName) {
    validateAdapterName(adapterName, { commandName });
  }

  const roles = {
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
  ADAPTER_CONFIG_ROLES,
  defaultAdapterConfig,
  normalizeAdapterConfig,
  resolveAdapterProviderForRole,
};
