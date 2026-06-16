"use strict";

const codexExec = require("./codex-exec");
const manual = require("./manual");
const opencode = require("./opencode");
const { normalizeLegacyAvailability } = require("./availability");

const CODEX_EXEC_ADAPTER = "codex-exec";
const MANUAL_ADAPTER = "manual";
const OPENCODE_ADAPTER = "opencode";

const adapters = new Map([
  [CODEX_EXEC_ADAPTER, codexExec],
  [MANUAL_ADAPTER, manual],
  [OPENCODE_ADAPTER, opencode],
]);

function getSupportedAdapterNames() {
  return Array.from(adapters.keys());
}

function formatSupportedAdapters() {
  return getSupportedAdapterNames().join(", ");
}

function missingAdapterMessage(commandName) {
  return `${commandName} requires --adapter ${CODEX_EXEC_ADAPTER}.`;
}

function unsupportedAdapterMessage(adapterName) {
  return `Unsupported dispatch adapter: ${adapterName}. Supported adapter: ${formatSupportedAdapters()}.`;
}

function validateAdapterName(adapterName, options = {}) {
  const commandName = options.commandName || "dispatch exec";

  if (!adapterName) {
    throw new Error(missingAdapterMessage(commandName));
  }

  if (!adapters.has(adapterName)) {
    throw new Error(unsupportedAdapterMessage(adapterName));
  }

  return adapterName;
}

function getAdapter(adapterName, options = {}) {
  validateAdapterName(adapterName, options);
  return adapters.get(adapterName);
}

function getAdapterCapabilities(adapterName, options = {}) {
  const adapter = getAdapter(adapterName, options);
  return { ...adapter.capabilities };
}

function getAdapterAvailability(adapterName, options = {}) {
  const adapter = getAdapter(adapterName, options);
  if (adapter.getAdapterAvailability) {
    return adapter.getAdapterAvailability(options);
  }

  const legacyAvailability = adapter.checkAdapterAvailability
    ? adapter.checkAdapterAvailability(options)
    : adapter.checkCodexExecAvailability(options);
  return normalizeLegacyAvailability(legacyAvailability, { provider: adapterName });
}

module.exports = {
  CODEX_EXEC_ADAPTER,
  MANUAL_ADAPTER,
  OPENCODE_ADAPTER,
  getSupportedAdapterNames,
  formatSupportedAdapters,
  missingAdapterMessage,
  unsupportedAdapterMessage,
  validateAdapterName,
  getAdapter,
  getAdapterAvailability,
  getAdapterCapabilities,
};
