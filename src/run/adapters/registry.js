"use strict";

const codexExec = require("./codex-exec");

const CODEX_EXEC_ADAPTER = "codex-exec";

const adapters = new Map([
  [CODEX_EXEC_ADAPTER, codexExec],
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

module.exports = {
  CODEX_EXEC_ADAPTER,
  getSupportedAdapterNames,
  formatSupportedAdapters,
  missingAdapterMessage,
  unsupportedAdapterMessage,
  validateAdapterName,
  getAdapter,
};
