"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { createFakeCodexAdapter } = require("../harness/lib/fake-adapter");
const { cleanupRepo, makeTempRepo, runNode } = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function parseJson(result, label) {
  assert(result.status === 0, `${label} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function createApprovedRun(repoRoot) {
  const planned = parseJson(runNode(cewpCli, [
    "supervise", "plan",
    "--goal", "Inspect one bounded behavior",
    "--scope", "README.md",
    "--verify", "git diff --check",
    "--stop", "The bounded behavior is inspected",
    "--json",
  ], repoRoot), "supervise plan");
  const runId = planned.data.run.runId;
  parseJson(runNode(cewpCli, [
    "supervise", "approve", runId, "--yes", "--json",
  ], repoRoot), "supervise approve");
  return runId;
}

function createApprovedRepairRun(repoRoot) {
  const verification = "node -e \"const fs=require('fs'); process.exit(fs.readFileSync('README.md','utf8').includes('Fake Codex')?1:0)\"";
  const planned = parseJson(runNode(cewpCli, [
    "supervise", "plan",
    "--goal", "Repair one bounded regression",
    "--scope", "README.md",
    "--verify", verification,
    "--stop", "The bounded regression is repaired",
    "--json",
  ], repoRoot), "repair supervise plan");
  const runId = planned.data.run.runId;
  parseJson(runNode(cewpCli, ["supervise", "approve", runId, "--yes", "--json"], repoRoot), "repair supervise approve");
  return runId;
}

function runRepairEffortContract() {
  const repoRoot = makeTempRepo("cewp-repair-effort-policy-");
  const fake = createFakeCodexAdapter();
  try {
    const runId = createApprovedRepairRun(repoRoot);
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "repair fixture grants dispatch authority");
    parseJson(runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, { env: fake.env }), "execute repair fixture");
    const failedVerification = runNode(cewpCli, [
      "supervise", "verify", runId, "--timeout", "20", "--json",
    ], repoRoot);
    assert(failedVerification.status === 1, "repair fixture reaches a failed verification gate");
    const failed = JSON.parse(failedVerification.stdout);
    assert(failed.data.run.status === "needs-repair", "failed verification exposes bounded repair");

    parseJson(runNode(cewpCli, [
      "supervise", "effort", runId,
      "--operation", "repair",
      "--task-class", "demanding-implementation",
      "--model", "gpt-test-repair",
      "--effort", "medium",
      "--yes", "--json",
    ], repoRoot), "approve repair effort policy");
    const retried = parseJson(runNode(cewpCli, [
      "supervise", "retry", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, {
      env: {
        ...fake.env,
        CEWP_FAKE_CODEX_EXPECT_MODEL: "gpt-test-repair",
        CEWP_FAKE_CODEX_EXPECT_EFFORT: "medium",
      },
    }), "retry with approved effort policy");
    const repairAttempt = retried.data.run.tasks[0].attempts.at(-1);
    assert(repairAttempt.kind === "repair", "repair attempt remains explicitly classified");
    assert(repairAttempt.codex.taskClass === "demanding-implementation", "repair evidence retains its task class");
    assert(repairAttempt.codex.effectiveModel.value === "gpt-test-repair", "repair evidence records the effective model");
    assert(repairAttempt.codex.effectiveEffort.value === "medium", "repair evidence records the effective effort");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

function runEffortTamperContract() {
  const repoRoot = makeTempRepo("cewp-effort-policy-tamper-");
  const fake = createFakeCodexAdapter();
  try {
    const runId = createApprovedRun(repoRoot);
    parseJson(runNode(cewpCli, [
      "supervise", "effort", runId,
      "--operation", "implementation",
      "--task-class", "demanding-implementation",
      "--model", "gpt-approved",
      "--effort", "high",
      "--yes", "--json",
    ], repoRoot), "approve tamper fixture policy");
    const policyPath = path.join(repoRoot, ".cewp", "supervised-runs", runId, "integration", "codex-effort-policy.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    policy.assignments.implementation.requested.model.value = "gpt-unapproved-edit";
    fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "tamper fixture grants dispatch authority");
    const refused = runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, { env: fake.env });
    assert(refused.status === 1, "modified effort sidecar cannot dispatch");
    assert(refused.stderr.includes("not operator-approved or was modified"), "tamper refusal explains the approval failure");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

function runStalePlanRevisionContract() {
  const repoRoot = makeTempRepo("cewp-effort-policy-stale-revision-");
  const fake = createFakeCodexAdapter();
  try {
    const runId = createApprovedRun(repoRoot);
    parseJson(runNode(cewpCli, [
      "supervise", "effort", runId,
      "--operation", "implementation",
      "--task-class", "demanding-implementation",
      "--model", "gpt-old-plan",
      "--effort", "high",
      "--yes", "--json",
    ], repoRoot), "approve old-plan effort policy");
    const revised = parseJson(runNode(cewpCli, [
      "supervise", "revise", runId,
      "--goal", "Inspect a revised bounded behavior",
      "--json",
    ], repoRoot), "revise effort-policy plan");
    assert(revised.data.run.planRevision === 2, "fixture creates a new plan revision");
    parseJson(runNode(cewpCli, ["supervise", "approve", runId, "--yes", "--json"], repoRoot), "approve revised plan");
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "stale revision fixture grants dispatch authority");
    const refused = runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, { env: fake.env });
    assert(refused.status === 1, "old-plan effort approval cannot dispatch a revised plan");
    assert(refused.stderr.includes("current plan revision"), "stale approval refusal names the plan-revision mismatch");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

function main() {
  const repoRoot = makeTempRepo("cewp-effort-policy-");
  const fake = createFakeCodexAdapter();
  try {
    const runId = createApprovedRun(repoRoot);
    const unapproved = runNode(cewpCli, [
      "supervise", "effort", runId,
      "--operation", "implementation",
      "--task-class", "fast-exploration",
      "--json",
    ], repoRoot);
    assert(unapproved.status === 1, "effort changes require explicit --yes approval");
    assert(unapproved.stderr.includes("explicit operator approval"), "approval refusal is actionable");
    const configured = parseJson(runNode(cewpCli, [
      "supervise", "effort", runId,
      "--operation", "implementation",
      "--task-class", "fast-exploration",
      "--yes", "--json",
    ], repoRoot), "supervise effort");

    assert(configured.command === "supervise.effort", "effort command identifies its public operation");
    const policy = configured.data.effortPolicy;
    assert(policy.schemaVersion === "codex-effort-policy/v1", "effort policy is versioned");
    assert(policy.provider === "codex", "provider identity stays in the integration sidecar");
    assert(policy.automaticModelRouting === false, "automatic model routing remains disabled");
    assert(policy.assignments.implementation.taskClass === "fast-exploration", "explicit task class is retained");
    assert(policy.assignments.implementation.requested.model.status === "unknown", "task class does not infer a model");
    assert(policy.assignments.implementation.requested.effort.status === "unknown", "task class does not infer effort");
    assert(policy.assignments.implementation.approval.kind === "operator", "operator approval is recorded");
    const canonicalRun = JSON.parse(fs.readFileSync(
      path.join(repoRoot, ".cewp", "supervised-runs", runId, "run.json"),
      "utf8",
    ));
    assert(canonicalRun.effortPolicy === undefined, "provider-specific effort policy stays outside canonical run state");

    const explicit = parseJson(runNode(cewpCli, [
      "supervise", "effort", runId,
      "--operation", "implementation",
      "--task-class", "demanding-implementation",
      "--model", "gpt-test-explicit",
      "--effort", "high",
      "--yes", "--json",
    ], repoRoot), "approve explicit model and effort");
    assert(explicit.data.effortPolicy.revision === 2, "approved setting change creates a new revision");
    const change = explicit.data.effortPolicy.history.at(-1);
    assert(change.previous.taskClass === "fast-exploration", "change history retains the previous task class");
    assert(change.previous.requested.model.status === "unknown", "change history retains the previous unknown model");
    assert(change.next.taskClass === "demanding-implementation", "change history retains the next task class");
    assert(change.next.requested.model.value === "gpt-test-explicit", "change history retains the approved next model");
    assert(change.next.requested.effort.value === "high", "change history retains the approved next effort");
    const approvalEvents = fs.readFileSync(
      path.join(repoRoot, ".cewp", "supervised-runs", runId, "events.jsonl"),
      "utf8",
    ).trim().split("\n").map((line) => JSON.parse(line))
      .filter((event) => event.type === "codex-effort-policy-approved");
    assert(approvalEvents.length === 2, "each effort policy approval is retained in the run event log");
    assert(approvalEvents.at(-1).revision === 2, "the event log identifies the approved policy revision");
    assert(
      approvalEvents.at(-1).selectionDigest === explicit.data.effortPolicy.assignments.implementation.approval.selectionDigest,
      "the event log binds the operator approval to the selected policy digest",
    );
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture grants dispatch authority");

    const executed = parseJson(runNode(cewpCli, [
      "supervise", "execute", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, {
      env: {
        ...fake.env,
        CEWP_FAKE_CODEX_EXPECT_MODEL: "gpt-test-explicit",
        CEWP_FAKE_CODEX_EXPECT_EFFORT: "high",
      },
    }), "execute with approved effort policy");
    const attempt = executed.data.run.tasks[0].attempts[0];
    assert(attempt.codex.taskClass === "demanding-implementation", "dispatch evidence retains the approved task class");
    assert(attempt.codex.effectiveModel.status === "known", "explicit dispatch model becomes known evidence");
    assert(attempt.codex.effectiveModel.value === "gpt-test-explicit", "effective model matches the approved override");
    assert(attempt.codex.effectiveEffort.status === "known", "explicit dispatch effort becomes known evidence");
    assert(attempt.codex.effectiveEffort.value === "high", "effective effort matches the approved override");

    const verified = parseJson(runNode(cewpCli, [
      "supervise", "verify", runId, "--timeout", "20", "--json",
    ], repoRoot), "verify explicit-effort checkpoint");
    assert(verified.data.run.status === "checkpoint-complete", "review setup retains the verification gate");
    parseJson(runNode(cewpCli, [
      "supervise", "effort", runId,
      "--operation", "reviewer",
      "--task-class", "high-effort-independent-review",
      "--model", "gpt-test-reviewer",
      "--effort", "xhigh",
      "--yes", "--json",
    ], repoRoot), "approve reviewer effort policy");
    const reviewed = parseJson(runNode(cewpCli, [
      "supervise", "review", runId, "--yes", "--timeout", "20", "--json",
    ], repoRoot, {
      env: {
        ...fake.env,
        CEWP_FAKE_CODEX_EXPECT_MODEL: "gpt-test-reviewer",
        CEWP_FAKE_CODEX_EXPECT_EFFORT: "xhigh",
      },
    }), "review with approved effort policy");
    assert(reviewed.data.run.reviewer.codex.taskClass === "high-effort-independent-review", "review evidence retains its task class");
    assert(reviewed.data.run.reviewer.codex.effectiveModel.value === "gpt-test-reviewer", "review evidence records the effective model");
    assert(reviewed.data.run.reviewer.codex.effectiveEffort.value === "xhigh", "review evidence records the effective effort");
  } finally {
    fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    cleanupRepo(repoRoot);
  }
}

try {
  main();
  runRepairEffortContract();
  runEffortTamperContract();
  runStalePlanRevisionContract();
  console.log("[PASS] Codex task classes never trigger automatic model routing");
} catch (error) {
  console.error("[FAIL] Codex effort policy contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
