"use strict";

const codexExec = require("./codex-exec");
const manual = require("./manual");

const CODEX_EXEC_ADAPTER = "codex-exec";
const MANUAL_ADAPTER = "manual";

const adapters = new Map([
  [CODEX_EXEC_ADAPTER, codexExec],
  [MANUAL_ADAPTER, manual],
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

module.exports = {
  CODEX_EXEC_ADAPTER,
  MANUAL_ADAPTER,
  getSupportedAdapterNames,
  formatSupportedAdapters,
  missingAdapterMessage,
  unsupportedAdapterMessage,
  validateAdapterName,
  getAdapter,
  getAdapterCapabilities,
};
