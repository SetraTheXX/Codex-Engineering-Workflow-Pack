"use strict";

const {
  assert,
  assertIncludes,
} = require("../harness/lib/assertions");
const {
  getAdapterAvailability,
  getAdapterCapabilities,
  getSupportedAdapterNames,
} = require("../../src/run/adapters/registry");
const {
  PROVIDER_PROFILE_SCHEMA_VERSION,
  getProviderProfile,
  getProviderProfiles,
} = require("../../src/run/adapters/profile");
const { normalizeAdapterResult } = require("../../src/run/adapters/codex-exec");

function runAdapterRegistryContract() {
  const supported = getSupportedAdapterNames();
  assert(
    JSON.stringify(supported) === JSON.stringify(["codex-exec", "manual", "opencode"]),
    `unexpected public adapters: ${supported.join(", ")}`,
  );

  const codex = getAdapterCapabilities("codex-exec");
  assert(codex.kind === "executing", "codex-exec remains executing");
  assert(codex.experimental !== true, "codex-exec remains stable");
  assert(codex.requiresExternalBinary === true, "codex-exec binary requirement");

  const manual = getAdapterCapabilities("manual");
  assert(manual.kind === "non-executing", "manual remains non-executing");
  assert(manual.supportsManualHandoff === true, "manual handoff capability");
  assert(manual.requiresExternalBinary === false, "manual has no binary requirement");

  const opencode = getAdapterCapabilities("opencode");
  assert(opencode.kind === "executing", "opencode remains executing");
  assert(opencode.experimental === true, "opencode remains experimental");
  assert(opencode.requiresAuth === true, "opencode auth requirement remains explicit");

  const manualAvailability = getAdapterAvailability("manual");
  assert(manualAvailability.available === true, "manual remains available");
  assert(manualAvailability.requirements.length === 0, "manual has no readiness requirements");

  const missingOpenCode = getAdapterAvailability("opencode", {
    env: { PATH: "", Path: "" },
  });
  assert(missingOpenCode.available === false, "missing opencode remains unavailable");
  assertIncludes(missingOpenCode.reason, "opencode executable not found", "missing opencode reason");
}

function runProviderProfileContract() {
  const profiles = getProviderProfiles({
    env: {
      ...process.env,
      CEWP_CODEX_EXEC_COMMAND: process.execPath,
      CEWP_OPENCODE_COMMAND: process.execPath,
    },
  });
  assert(profiles.length === 3, "provider profiles mirror the public registry");
  assert(
    profiles.every((profile) => profile.schemaVersion === PROVIDER_PROFILE_SCHEMA_VERSION),
    "provider profile schema version",
  );

  const codex = profiles.find((profile) => profile.provider === "codex-exec");
  assert(codex.binaryReadiness === "installed", "codex-exec binary readiness");
  assert(codex.authReadiness === "not-applicable", "codex-exec auth behavior unchanged");

  const manual = profiles.find((profile) => profile.provider === "manual");
  assert(manual.binaryReadiness === "not-applicable", "manual binary readiness");
  assert(manual.authReadiness === "not-applicable", "manual auth readiness");

  const opencode = profiles.find((profile) => profile.provider === "opencode");
  assert(opencode.binaryReadiness === "installed", "opencode binary readiness");
  assert(opencode.authReadiness === "unknown", "opencode auth readiness remains unknown");

  const configuredOpenCode = getProviderProfile("opencode", {
    model: "provider/test-model",
    env: { CEWP_OPENCODE_COMMAND: process.execPath },
  });
  assert(configuredOpenCode.model === "provider/test-model", "opencode model override");
  assert(
    configuredOpenCode.authReadiness === "unknown",
    "opencode model override does not imply auth readiness",
  );

  const missingOpenCode = getProviderProfile("opencode", {
    env: { PATH: "", Path: "" },
  });
  assert(missingOpenCode.binaryReadiness === "missing", "missing opencode profile binary readiness");
  assert(missingOpenCode.authReadiness === "unknown", "missing opencode profile auth readiness");
}

function runAdapterResultContract() {
  const result = normalizeAdapterResult({
    provider: "codex-exec",
    role: "worker-a",
    status: "FAIL",
    exitCode: 7,
    reasons: ["codex exec exited with code 7."],
    paths: {
      stdout: "adapter-output/worker-a-stdout.log",
      lastMessage: "adapter-output/worker-a-last-message.md",
    },
  });

  assert(result.schemaVersion === "adapter-result/v1", "adapter result schema version");
  assert(result.provider === "codex-exec", "adapter result provider");
  assert(result.ok === false, "adapter result failure state");
  assert(result.exitCode === 7, "adapter result exit code");
  assert(result.reason === "codex exec exited with code 7.", "adapter result reason");
  assert(result.capabilitiesUsed.includes("externalCommand"), "adapter result external command capability");
  assert(result.capabilitiesUsed.includes("lastMessage"), "adapter result last-message capability");
  assert(
    result.artifacts.some((artifact) => artifact.type === "stdout-log"),
    "adapter result stdout artifact",
  );
}

try {
  runAdapterRegistryContract();
  runProviderProfileContract();
  runAdapterResultContract();
  console.log("[PASS] adapter, provider profile, and adapter result contracts");
} catch (error) {
  console.error("[FAIL] adapter, provider profile, and adapter result contracts");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
