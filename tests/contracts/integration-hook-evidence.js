"use strict";

const fs = require("node:fs");
const childProcess = require("node:child_process");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode } = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const { recordSubagentHookEvent } = require("../../src/integration/hook-evidence");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function assertThrows(action, expected, label) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  assert(error, `${label}: expected an error`);
  assert(expected.test(error.message), `${label}: unexpected error: ${error.message}`);
}

function main() {
  const repoRoot = makeTempRepo("cewp-hook-evidence-");
  try {
    const run = approveWorkflow(repoRoot, validDefinition());
    const runPath = path.join(repoRoot, ".cewp", "workflow-runs", run.runId, "run.json");
    const runBefore = fs.readFileSync(runPath, "utf8");
    const refused = runNode(cewpCli, [
      "integration", "hooks", "approve", run.runId, "--json",
    ], repoRoot, {
      env: { ...process.env, CEWP_HOOK_CODEX_VERSION: "codex-cli 0.200.0" },
    });
    assert(refused.status === 1, "hook trust cannot be activated without explicit --yes approval");
    assert(refused.stderr.includes("explicit operator approval"), "approval refusal explains the trust boundary");
    const approved = runNode(cewpCli, [
      "integration", "hooks", "approve", run.runId, "--yes", "--json",
    ], repoRoot, {
      env: { ...process.env, CEWP_HOOK_CODEX_VERSION: "codex-cli 0.200.0" },
    });
    assert(approved.status === 0, `hook approval succeeds: ${approved.stderr}`);
    const output = JSON.parse(approved.stdout);
    assert(output.command === "integration.hooks.approve", "approval identifies the public command");
    assert(output.data.trust.schemaVersion === "codex-hook-trust/v1", "hook trust is versioned");
    assert(output.data.trust.cewpVersion === "0.11.0-beta.0", "approval binds the CEWP runtime version");
    assert(output.data.trust.codexVersion === "codex-cli 0.200.0", "approval binds the observed Codex version");
    assert(/^sha256:[a-f0-9]{64}$/.test(output.data.trust.bundleDigest), "approval binds the exact hook bundle");
    assert(output.data.nextAction.command === "/hooks", "approval still requires the host trust review");
    assert(fs.readFileSync(runPath, "utf8") === runBefore, "hook trust stays outside provider-neutral run state");

    const inspected = runNode(cewpCli, [
      "integration", "hooks", "status", run.runId, "--json",
    ], repoRoot, {
      env: { ...process.env, CEWP_HOOK_CODEX_VERSION: "codex-cli 0.200.0" },
    });
    assert(inspected.status === 0, `hook status succeeds: ${inspected.stderr}`);
    const status = JSON.parse(inspected.stdout);
    assert(status.command === "integration.hooks.status", "status identifies the public inspection command");
    assert(status.data.compatible === true && status.data.active === true, "current approved hook evidence is active");
    assert(status.data.claims.coreEnforcement === false, "status never promotes hook evidence to Core enforcement");

    const driftStatus = runNode(cewpCli, [
      "integration", "hooks", "status", run.runId, "--json",
    ], repoRoot, {
      env: { ...process.env, CEWP_HOOK_CODEX_VERSION: "codex-cli 0.201.0" },
    });
    assert(driftStatus.status === 0, `hook drift status remains inspectable: ${driftStatus.stderr}`);
    const drift = JSON.parse(driftStatus.stdout).data;
    assert(drift.compatible === false && drift.active === false, "version drift disables trusted hook evidence");
    assert(drift.warnings[0].code === "codex-version-drift", "version drift has a stable compatibility code");
    assert(drift.fallback === "core-and-conversation-only", "version drift names the safe fallback");

    const hookPath = path.join(__dirname, "..", "..", "plugins", "cewp", "hooks", "capture-subagent.js");
    const runHook = (input) => childProcess.spawnSync(process.execPath, [hookPath], {
      cwd: repoRoot,
      input: JSON.stringify(input),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        CEWP_HOOK_CODEX_VERSION: "codex-cli 0.200.0",
        CEWP_HOOK_CLI_COMMAND: process.execPath,
        CEWP_HOOK_CLI_PREFIX_ARGS: JSON.stringify([cewpCli]),
      },
    });
    const common = {
      session_id: "parent-session-1",
      transcript_path: path.join(repoRoot, "does-not-exist.jsonl"),
      cwd: repoRoot,
      model: "gpt-test-host",
      turn_id: "parent-turn-1",
      agent_id: "agent-1",
      agent_type: "explorer",
      permission_mode: "default",
    };
    const started = runHook({ ...common, hook_event_name: "SubagentStart" });
    assert(started.status === 0, `SubagentStart hook succeeds: ${started.stderr}`);
    assert(JSON.stringify(JSON.parse(started.stdout)) === "{}", "evidence-only start does not steer the subagent");
    const stopped = runHook({
      ...common,
      hook_event_name: "SubagentStop",
      agent_transcript_path: path.join(repoRoot, "also-does-not-exist.jsonl"),
      stop_hook_active: false,
      last_assistant_message: "Inspected the bounded files and found no scope issue.",
    });
    assert(stopped.status === 0, `SubagentStop hook succeeds: ${stopped.stderr}`);
    assert(JSON.stringify(JSON.parse(stopped.stdout)) === "{}", "evidence-only stop does not continue or block the subagent");

    const ledgerPath = path.join(
      repoRoot, ".cewp", "workflow-runs", run.runId, "integration", "subagent-hook-evidence.jsonl",
    );
    const evidence = fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert(evidence.length === 2, "start and stop lifecycle evidence are append-only");
    assert(evidence[0].type === "subagent-started" && evidence[1].type === "subagent-stopped", "supported lifecycle types are normalized");
    assert(evidence[1].references.agentId === "agent-1", "documented subagent id is preserved");
    assert(evidence[1].references.parentSessionId === "parent-session-1", "documented parent session is preserved");
    assert(evidence[1].references.agentThreadId.status === "unknown", "an unavailable subagent thread id is never invented");
    assert(evidence[1].summary.value.includes("no scope issue"), "bounded host summary is retained");
    assert(evidence[1].claims.coreEnforcement === false, "hook evidence never claims Core enforcement");

    const ledgerBeforeDrift = fs.readFileSync(ledgerPath, "utf8");
    const versionDrift = childProcess.spawnSync(process.execPath, [hookPath], {
      cwd: repoRoot,
      input: JSON.stringify({ ...common, hook_event_name: "SubagentStart", agent_id: "agent-drift" }),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        CEWP_HOOK_CODEX_VERSION: "codex-cli 0.201.0",
        CEWP_HOOK_CLI_COMMAND: process.execPath,
        CEWP_HOOK_CLI_PREFIX_ARGS: JSON.stringify([cewpCli]),
      },
    });
    assert(versionDrift.status === 0, "version drift does not break the host lifecycle");
    assert(JSON.parse(versionDrift.stdout).systemMessage.includes("version drift"), "version drift is visible and actionable");
    assert(fs.readFileSync(ledgerPath, "utf8") === ledgerBeforeDrift, "version drift cannot append trusted evidence");

    const malformed = runHook({ ...common, hook_event_name: "SubagentStart", agent_id: null });
    assert(malformed.status === 0, "malformed hook input fails without breaking the host lifecycle");
    assert(JSON.parse(malformed.stdout).systemMessage.includes("agent_id is required"), "malformed input explains the compatibility failure");
    assert(fs.readFileSync(ledgerPath, "utf8") === ledgerBeforeDrift, "malformed input cannot append evidence");

    const changedPluginRoot = path.join(repoRoot, "changed-plugin");
    fs.mkdirSync(path.join(changedPluginRoot, "hooks"), { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, "..", "..", "plugins", "cewp", "hooks", "hooks.json"),
      path.join(changedPluginRoot, "hooks", "hooks.json"),
    );
    fs.copyFileSync(hookPath, path.join(changedPluginRoot, "hooks", "capture-subagent.js"));
    fs.appendFileSync(path.join(changedPluginRoot, "hooks", "capture-subagent.js"), "\n// changed after review\n");
    assertThrows(
      () => recordSubagentHookEvent({
        repoRoot,
        input: { ...common, hook_event_name: "SubagentStart", agent_id: "agent-definition-drift" },
        codexVersion: "codex-cli 0.200.0",
        pluginRoot: changedPluginRoot,
      }),
      /definition drift/,
      "changed hook definitions require a fresh review",
    );
    assert(fs.readFileSync(ledgerPath, "utf8") === ledgerBeforeDrift, "definition drift cannot append trusted evidence");
    assert(fs.readFileSync(runPath, "utf8") === runBefore, "hook failures and observations never mutate Core workflow state");

    const trustPath = path.join(
      repoRoot, ".cewp", "workflow-runs", run.runId, "integration", "codex-hook-trust.json",
    );
    fs.writeFileSync(trustPath, "{ malformed trust receipt\n");
    const malformedTrustStatus = runNode(cewpCli, [
      "integration", "hooks", "status", run.runId, "--json",
    ], repoRoot, {
      env: { ...process.env, CEWP_HOOK_CODEX_VERSION: "codex-cli 0.200.0" },
    });
    assert(malformedTrustStatus.status === 0, "malformed trust remains inspectable through a fail-safe status");
    const malformedTrust = JSON.parse(malformedTrustStatus.stdout).data;
    assert(malformedTrust.active === false && malformedTrust.compatible === false, "malformed trust disables evidence");
    assert(malformedTrust.warnings[0].code === "hook-trust-change", "malformed trust has a stable warning code");
    assert(malformedTrust.fallback === "core-and-conversation-only", "malformed trust preserves the safe fallback");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  main();
  console.log("[PASS] hook evidence is explicitly approved and version-bound");
} catch (error) {
  console.error("[FAIL] hook evidence integration contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
