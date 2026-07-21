"use strict";

const CODEX_INTEGRATION_CAPABILITIES_SCHEMA_VERSION = "codex-integration-capabilities/v1";
const CAPABILITY_STATUSES = Object.freeze(["supported", "experimental", "unavailable", "unknown"]);
const MANAGED_BACKENDS = Object.freeze(["codex-exec", "app-server"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid Codex capability snapshot: ${label} is required.`);
  }
  return value.trim();
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid Codex capability snapshot: ${label} must be true or false.`);
  }
  return value;
}

function normalizeTimestamp(value, label) {
  const timestamp = requiredText(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Invalid Codex capability snapshot: ${label} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeStatus(value, label) {
  const status = requiredText(value.status, `${label}.status`);
  if (!CAPABILITY_STATUSES.includes(status)) {
    throw new Error(`Invalid Codex capability snapshot: ${label}.status must be ${CAPABILITY_STATUSES.join(", ")}.`);
  }
  return status;
}

function normalizeSurface(value, label) {
  if (!isObject(value)) {
    throw new Error(`Invalid Codex capability snapshot: ${label} is required.`);
  }
  const status = normalizeStatus(value, label);
  if (["unavailable", "unknown"].includes(status)) {
    return {
      status,
      reason: requiredText(value.reason, `${label}.reason`),
    };
  }
  return { ...value, status };
}

function normalizeNativeGoal(value) {
  const surface = normalizeSurface(value, "surfaces.nativeGoal");
  if (!["supported", "experimental"].includes(surface.status)) return surface;
  const access = requiredText(surface.access, "surfaces.nativeGoal.access");
  if (!["host-mediated", "explicit-intake"].includes(access)) {
    throw new Error("Invalid Codex capability snapshot: native goal access must be host-mediated or explicit-intake.");
  }
  const statuses = Array.isArray(surface.statuses)
    ? surface.statuses.map((status, index) => requiredText(status, `surfaces.nativeGoal.statuses[${index}]`))
    : [];
  if (statuses.length === 0 || new Set(statuses).size !== statuses.length) {
    throw new Error("Invalid Codex capability snapshot: native goal statuses must be a non-empty unique array.");
  }
  return {
    ...surface,
    access,
    schemaVersion: requiredText(surface.schemaVersion, "surfaces.nativeGoal.schemaVersion"),
    statuses,
  };
}

function normalizeAppServer(value) {
  const surface = normalizeSurface(value, "surfaces.appServer");
  if (!["supported", "experimental"].includes(surface.status)) return surface;
  if (requiredBoolean(surface.separateProcessRequired, "surfaces.appServer.separateProcessRequired") !== true) {
    throw new Error("Invalid Codex capability snapshot: App Server must remain a separately owned process.");
  }
  if (requiredBoolean(surface.existingDesktopSessionAccess, "surfaces.appServer.existingDesktopSessionAccess")) {
    throw new Error("Invalid Codex capability snapshot: App Server must not claim access to an existing ChatGPT desktop session.");
  }
  return {
    ...surface,
    transport: requiredText(surface.transport, "surfaces.appServer.transport"),
    separateProcessRequired: true,
    existingDesktopSessionAccess: false,
  };
}

function normalizeHostObservation(value) {
  const surface = normalizeSurface(value, "surfaces.hostObservation");
  if (surface.status !== "supported") return surface;
  if (surface.pluginPathCapabilityTestPassed !== true) {
    throw new Error(
      "Invalid Codex capability snapshot: supported host observation requires pluginPathCapabilityTestPassed.",
    );
  }
  if (surface.source !== "plugin") {
    throw new Error("Invalid Codex capability snapshot: plugin-observed host data must identify source plugin.");
  }
  return {
    ...surface,
    pluginPathCapabilityTestPassed: true,
    source: "plugin",
  };
}

function normalizeManagedBackendDecision(value, appServer) {
  if (!isObject(value)) {
    throw new Error("Invalid Codex capability snapshot: managedBackendDecision is required.");
  }
  const selected = requiredText(value.selected, "managedBackendDecision.selected");
  if (!MANAGED_BACKENDS.includes(selected)) {
    throw new Error(`Invalid Codex capability snapshot: unsupported managed backend ${selected}.`);
  }
  const appServerGraduated = requiredBoolean(
    value.appServerGraduated,
    "managedBackendDecision.appServerGraduated",
  );
  if (selected === "app-server" && !appServerGraduated) {
    throw new Error("Invalid Codex capability snapshot: App Server cannot be selected before graduation.");
  }
  if (appServerGraduated) {
    const materialAdvantage = value.materialAdvantage;
    if (
      appServer.status !== "supported"
      || !isObject(materialAdvantage)
      || !["lifecycle", "usage", "recovery"].some((name) => materialAdvantage[name] === true)
      || value.processOwnershipProved !== true
      || value.authenticationBoundaryProved !== true
      || value.cleanupProved !== true
    ) {
      throw new Error(
        "Invalid Codex capability snapshot: App Server graduation requires a supported surface, material advantage, process ownership, authentication boundary, and cleanup proof.",
      );
    }
  }
  return {
    ...value,
    selected,
    appServerGraduated,
    reason: requiredText(value.reason, "managedBackendDecision.reason"),
  };
}

function validateCodexCapabilitySnapshot(value) {
  if (!isObject(value) || value.schemaVersion !== CODEX_INTEGRATION_CAPABILITIES_SCHEMA_VERSION) {
    throw new Error(
      `Invalid Codex capability snapshot: expected ${CODEX_INTEGRATION_CAPABILITIES_SCHEMA_VERSION}.`,
    );
  }
  if (!isObject(value.probe)) {
    throw new Error("Invalid Codex capability snapshot: probe is required.");
  }
  if (!isObject(value.surfaces)) {
    throw new Error("Invalid Codex capability snapshot: surfaces are required.");
  }

  const appServer = normalizeAppServer(value.surfaces.appServer);
  const surfaces = {
    plugin: normalizeSurface(value.surfaces.plugin, "surfaces.plugin"),
    nativeGoal: normalizeNativeGoal(value.surfaces.nativeGoal),
    appServer,
    mcp: normalizeSurface(value.surfaces.mcp, "surfaces.mcp"),
    hooks: normalizeSurface(value.surfaces.hooks, "surfaces.hooks"),
    hostObservation: normalizeHostObservation(value.surfaces.hostObservation),
  };

  return {
    schemaVersion: CODEX_INTEGRATION_CAPABILITIES_SCHEMA_VERSION,
    generatedAt: normalizeTimestamp(value.generatedAt, "generatedAt"),
    codexVersion: requiredText(value.codexVersion, "codexVersion"),
    probe: {
      kind: requiredText(value.probe.kind, "probe.kind"),
      authenticationBoundary: requiredText(
        value.probe.authenticationBoundary,
        "probe.authenticationBoundary",
      ),
      modelTurnStarted: requiredBoolean(value.probe.modelTurnStarted, "probe.modelTurnStarted"),
    },
    surfaces,
    managedBackendDecision: normalizeManagedBackendDecision(value.managedBackendDecision, appServer),
  };
}

function selectManagedBackend(snapshot, requested = "auto") {
  const normalized = validateCodexCapabilitySnapshot(snapshot);
  if (!["auto", ...MANAGED_BACKENDS].includes(requested)) {
    throw new Error(`Unsupported managed backend request: ${requested}.`);
  }
  if (requested === "codex-exec") return "codex-exec";
  if (
    normalized.managedBackendDecision.selected === "app-server"
    && normalized.managedBackendDecision.appServerGraduated
  ) {
    return "app-server";
  }
  return "codex-exec";
}

function assessCodexCompatibility(snapshot, current = {}) {
  const normalized = validateCodexCapabilitySnapshot(snapshot);
  const warnings = [];
  if (current.codexVersion && current.codexVersion !== normalized.codexVersion) {
    warnings.push({
      code: "codex-version-drift",
      expected: normalized.codexVersion,
      observed: current.codexVersion,
    });
  }

  const nativeGoal = normalized.surfaces.nativeGoal;
  if (!["supported", "experimental"].includes(nativeGoal.status)) {
    warnings.push({
      code: "native-goal-unavailable",
      observed: nativeGoal.status,
      reason: nativeGoal.reason,
    });
  } else if (
    current.nativeGoalSchemaVersion
    && current.nativeGoalSchemaVersion !== nativeGoal.schemaVersion
  ) {
    warnings.push({
      code: "native-goal-schema-drift",
      expected: nativeGoal.schemaVersion,
      observed: current.nativeGoalSchemaVersion,
    });
  }

  return {
    schemaVersion: "codex-integration-compatibility/v1",
    compatible: warnings.length === 0,
    warnings,
    fallback: warnings.length > 0 ? "generated-goal-or-explicit-intake" : null,
    managedBackend: selectManagedBackend(normalized),
  };
}

module.exports = {
  CAPABILITY_STATUSES,
  CODEX_INTEGRATION_CAPABILITIES_SCHEMA_VERSION,
  assessCodexCompatibility,
  selectManagedBackend,
  validateCodexCapabilitySnapshot,
};
