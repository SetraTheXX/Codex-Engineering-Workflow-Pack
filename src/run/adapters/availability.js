"use strict";

function normalizeAvailabilityStatus(available) {
  return available ? "available" : "unavailable";
}

function normalizeRequirement(requirement) {
  return {
    type: requirement.type,
    name: requirement.name,
    required: Boolean(requirement.required),
    available: Boolean(requirement.available),
    ...(requirement.command ? { command: requirement.command } : {}),
  };
}

function normalizeAdapterAvailability({
  provider,
  available,
  reason = null,
  remediation = null,
  requirements = [],
  command = null,
  version = null,
  probe = null,
} = {}) {
  return {
    provider,
    available: Boolean(available),
    status: normalizeAvailabilityStatus(Boolean(available)),
    reason,
    remediation,
    requirements: requirements.map(normalizeRequirement),
    ...(command ? { command } : {}),
    ...(version ? { version } : {}),
    ...(probe ? { probe } : {}),
  };
}

function normalizeLegacyAvailability(legacyAvailability = {}, options = {}) {
  const provider = options.provider || legacyAvailability.provider || legacyAvailability.adapter;
  const available = legacyAvailability.status === "PASS";

  return normalizeAdapterAvailability({
    provider,
    available,
    reason: legacyAvailability.reason || null,
    remediation: legacyAvailability.remediation || null,
    requirements: options.requirements || [],
    command: legacyAvailability.command || null,
    version: legacyAvailability.version || null,
    probe: legacyAvailability.probe || null,
  });
}

module.exports = {
  normalizeAdapterAvailability,
  normalizeLegacyAvailability,
};
