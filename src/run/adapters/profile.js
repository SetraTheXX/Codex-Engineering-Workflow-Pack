"use strict";

const {
  getAdapterAvailability,
  getAdapterCapabilities,
  getSupportedAdapterNames,
} = require("./registry");

const PROVIDER_PROFILE_SCHEMA_VERSION = "provider-profile/v1";

function getBinaryRequirement(availability = {}) {
  return (availability.requirements || []).find((requirement) => requirement.type === "binary");
}

function getBinaryReadiness(capabilities = {}, availability = {}) {
  if (!capabilities.requiresExternalBinary) {
    return "not-applicable";
  }

  const requirement = getBinaryRequirement(availability);
  if (!requirement) {
    return "unknown";
  }

  return requirement.available ? "installed" : "missing";
}

function getAuthReadiness(capabilities = {}) {
  return capabilities.requiresAuth ? "unknown" : "not-applicable";
}

function getSupportedFeatures(capabilities = {}) {
  const features = [];

  if (capabilities.supportsDryRun) {
    features.push("dry-run");
  }
  if (capabilities.executesExternalCommand) {
    features.push("external-command");
  }
  if (capabilities.supportsManualHandoff) {
    features.push("manual-handoff");
  }
  if (capabilities.supportsResultIntake) {
    features.push("result-intake");
  }
  if (capabilities.supportsLastMessage) {
    features.push("last-message");
  }

  return features;
}

function buildProviderProfile({ provider, capabilities = {}, availability = {} } = {}) {
  const binaryRequirement = getBinaryRequirement(availability);

  return {
    schemaVersion: PROVIDER_PROFILE_SCHEMA_VERSION,
    id: provider,
    provider,
    mode: capabilities.kind === "non-executing" ? "manual" : "headless",
    experimental: Boolean(capabilities.experimental),
    command: availability.command || null,
    model: null,
    binary: binaryRequirement ? binaryRequirement.name : null,
    version: availability.version || null,
    binaryReadiness: getBinaryReadiness(capabilities, availability),
    authReadiness: getAuthReadiness(capabilities),
    supportedFeatures: getSupportedFeatures(capabilities),
    safety: {
      cewpGuardrailsRequired: true,
      allowedFilesRequiredForWorkers: true,
      reviewerPassRequiredForFinalize: true,
      automaticMergePushPublishRelease: false,
    },
  };
}

function getProviderProfile(provider, options = {}) {
  return buildProviderProfile({
    provider,
    capabilities: getAdapterCapabilities(provider, options),
    availability: getAdapterAvailability(provider, options),
  });
}

function getProviderProfiles(options = {}) {
  return getSupportedAdapterNames().map((provider) => getProviderProfile(provider, options));
}

module.exports = {
  PROVIDER_PROFILE_SCHEMA_VERSION,
  buildProviderProfile,
  getProviderProfile,
  getProviderProfiles,
};
