"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { createFakeCodexAdapter, FAKE_ADAPTER_MODES } = require("../harness/lib/fake-adapter");
const { cleanupRepo, makeTempRepo, runNode } = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function parseJson(result, label) {
  assert(result.status === 0, `${label} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function parseRejectedJson(result, label) {
  assert(result.status === 1, `${label} must close the CLI success gate`);
  assert(result.stdout.trim().startsWith("{"), `${label} must still return structured diagnostics`);
  return JSON.parse(result.stdout);
}

function createVerifiedRun(repoRoot, fake, options = {}) {
  const args = [
    "supervise", "plan",
    "--goal", options.goal || "Review one bounded README change",
    "--scope", "README.md",
    "--verify", "git diff --check",
    "--stop", "The approved non-test verification passes",
  ];
  if (options.assurance) args.push("--assurance", options.assurance);
  if (options.testAuthoring) args.push("--test-authoring", options.testAuthoring);
  if (options.fullVerification) args.push("--full-verify", "git status --short");
  args.push("--json");
  const planned = parseJson(runNode(cewpCli, args, repoRoot), "plan review fixture");
  const runId = planned.data.run.runId;
  parseJson(runNode(cewpCli, ["supervise", "approve", runId, "--yes", "--json"], repoRoot), "approve review fixture");
  parseJson(runNode(cewpCli, [
    "supervise", "execute", runId, "--yes", "--json",
  ], repoRoot, { env: fake.env }), "execute review fixture");
  const verified = parseJson(runNode(cewpCli, ["supervise", "verify", runId, "--json"], repoRoot), "verify review fixture");
  assert(verified.data.run.status === "checkpoint-complete", "review fixture reaches only the verified checkpoint gate");
  return runId;
}

function runReviewerDecisionContract() {
  const repoRoot = makeTempRepo("cewp-supervised-review-");
  const requestChanges = createFakeCodexAdapter(FAKE_ADAPTER_MODES.REVIEWER_REQUEST_CHANGES);
  const missingDecision = createFakeCodexAdapter(FAKE_ADAPTER_MODES.REVIEWER_MISSING_DECISION);
  const testAuthor = createFakeCodexAdapter(FAKE_ADAPTER_MODES.TEST_AUTHORING);
  const pass = createFakeCodexAdapter();
  try {
    assert(runNode(cewpCli, ["policy", "set", "full-authority"], repoRoot).status === 0, "fixture grants worker and reviewer authority");

    const changesRunId = createVerifiedRun(repoRoot, requestChanges, {
      goal: "Exercise reviewer requested changes",
      fullVerification: true,
    });
    const changes = parseRejectedJson(runNode(cewpCli, [
      "supervise", "review", changesRunId, "--yes", "--json",
    ], repoRoot, { env: requestChanges.env }), "reviewer requests changes");
    assert(changes.data.ok === false, "REQUEST_CHANGES never counts as reviewer PASS");
    assert(changes.data.run.status === "needs-repair", "REQUEST_CHANGES returns the run to bounded repair");
    assert(changes.data.run.tasks[0].status === "repair-ready", "requested changes open only the repair action");
    assert(changes.data.run.tasks[0].blocker.code === "reviewer-request-changes", "reviewer reason remains canonical evidence");
    assert(changes.data.nextAction.command.includes("supervise retry"), "requested changes expose an executable recovery command");
    const changesReceipt = runNode(cewpCli, ["supervise", "receipt", changesRunId, "--json"], repoRoot);
    assert(changesReceipt.status === 1 && changesReceipt.stderr.includes("reviewer PASS"), "REQUEST_CHANGES cannot preview a receipt");
    const repaired = parseJson(runNode(cewpCli, [
      "supervise", "retry", changesRunId, "--yes", "--json",
    ], repoRoot, { env: pass.env }), "repair reviewer requested changes");
    assert(repaired.data.run.status === "verifying", "reviewer repair reuses the owned worktree and returns to verification");
    assert(repaired.data.run.tasks[0].attempts.at(-1).kind === "repair", "reviewer recovery consumes one bounded repair attempt");
    const exhaustedFull = runNode(cewpCli, [
      "supervise", "verify", changesRunId, "--json",
    ], repoRoot);
    assert(exhaustedFull.status === 1 && exhaustedFull.stderr.includes("paused-budget-unverified"), "exhausted full verification budget pauses before running checks");
    const paused = parseJson(runNode(cewpCli, [
      "supervise", "status", changesRunId, "--json",
    ], repoRoot), "inspect exhausted full verification budget");
    assert(paused.data.run.status === "paused-budget-unverified", "local verification exhaustion is canonical pause state");
    assert(paused.data.run.pause.reason === "full-verification-budget-exhausted", "pause identifies the exhausted local budget");
    const expanded = parseJson(runNode(cewpCli, [
      "supervise", "add-budget", changesRunId,
      "--operations", "1", "--allocation", "full-verification", "--yes", "--json",
    ], repoRoot), "expand full verification budget");
    assert(expanded.data.run.budget.modelOperations.value === 10, "local verification expansion does not inflate model-operation ceiling");
    assert(expanded.data.run.budget.maxFullVerificationRuns.value === 2, "explicit expansion adds one local full verification run");
    parseJson(runNode(cewpCli, [
      "supervise", "resume", changesRunId, "--yes", "--json",
    ], repoRoot), "resume after full verification expansion");
    const reverified = parseJson(runNode(cewpCli, [
      "supervise", "verify", changesRunId, "--json",
    ], repoRoot), "verify reviewer repair");
    assert(reverified.data.run.status === "checkpoint-complete", "reviewer repair must pass local verification before review can reopen");

    const missingRunId = createVerifiedRun(repoRoot, missingDecision, { goal: "Exercise missing reviewer decision" });
    const missing = parseRejectedJson(runNode(cewpCli, [
      "supervise", "review", missingRunId, "--yes", "--json",
    ], repoRoot, { env: missingDecision.env }), "reviewer omits decision");
    assert(missing.data.ok === false && missing.data.run.status === "blocked", "missing decision closes the review gate");
    assert(missing.data.run.reviewer.decision === null, "missing decision is not inferred as PASS");
    assert(missing.data.run.tasks[0].blocker.reasons.includes("missing-reviewer-decision"), "missing decision has an actionable blocker reason");
    const missingReceipt = runNode(cewpCli, ["supervise", "receipt", missingRunId, "--json"], repoRoot);
    assert(missingReceipt.status === 1, "blocked review cannot preview a receipt");

    const prototypeRunId = createVerifiedRun(repoRoot, pass, {
      goal: "Exercise prototype never-test policy",
      assurance: "prototype",
      testAuthoring: "never",
    });
    const prototypeReview = parseJson(runNode(cewpCli, [
      "supervise", "review", prototypeRunId, "--yes", "--json",
    ], repoRoot, { env: pass.env }), "review prototype fixture");
    assert(prototypeReview.data.run.assurance.testAuthoring === "never", "never test-authoring policy survives execution and review");
    assert(prototypeReview.data.run.tasks[0].verification.runs.some((entry) => entry.stage === "targeted" && entry.status === "pass"), "never still requires approved non-test verification evidence");
    assert(prototypeReview.data.run.tasks[0].attempts.every((attempt) => attempt.changedFiles.every((file) => !/test|spec/i.test(file))), "never fixture does not create test files");
    const prototypeReceipt = parseJson(runNode(cewpCli, [
      "supervise", "receipt", prototypeRunId, "--json",
    ], repoRoot), "preview prototype receipt");
    assert(prototypeReceipt.data.receipt.assurance.productionVerificationClaimAllowed === false, "prototype receipt closes production-verification claim");
    assert(prototypeReceipt.data.receipt.warnings.includes("Prototype assurance cannot claim production verification."), "prototype limitation is visible in the receipt");

    const neverPlan = parseJson(runNode(cewpCli, [
      "supervise", "plan",
      "--goal", "Refuse unapproved test authoring",
      "--scope", "tests/generated.test.js",
      "--verify", "git diff --check",
      "--stop", "No test file is authored",
      "--test-authoring", "never",
      "--json",
    ], repoRoot), "plan never test-authoring enforcement fixture");
    const neverRunId = neverPlan.data.run.runId;
    parseJson(runNode(cewpCli, [
      "supervise", "approve", neverRunId, "--yes", "--json",
    ], repoRoot), "approve never test-authoring enforcement fixture");
    const neverExecution = parseRejectedJson(runNode(cewpCli, [
      "supervise", "execute", neverRunId, "--yes", "--json",
    ], repoRoot, { env: testAuthor.env }), "never test-authoring enforcement");
    assert(neverExecution.data.ok === false, "never rejects a test file even when it is inside approved scope");
    assert(neverExecution.data.run.status === "blocked", "test-authoring policy violation closes the checkpoint gate");
    assert(neverExecution.data.run.tasks[0].attempts[0].testAuthoring.status === "fail", "attempt records the enforced test-authoring verdict");
    assert(neverExecution.data.run.tasks[0].blocker.reasons.some((reason) => reason.includes("Test authoring policy never")), "blocker explains the assurance violation");

    const askWithoutApproval = parseJson(runNode(cewpCli, [
      "supervise", "plan",
      "--goal", "Require an explicit test-authoring decision",
      "--scope", "tests/generated.test.js",
      "--verify", "git diff --check",
      "--stop", "The operator explicitly decides whether tests may be authored",
      "--test-authoring", "ask",
      "--json",
    ], repoRoot), "plan ask test-authoring fixture");
    const askWithoutApprovalId = askWithoutApproval.data.run.runId;
    parseJson(runNode(cewpCli, [
      "supervise", "approve", askWithoutApprovalId, "--yes", "--json",
    ], repoRoot), "approve ask fixture without test authorization");
    const unapprovedTest = parseRejectedJson(runNode(cewpCli, [
      "supervise", "execute", askWithoutApprovalId, "--yes", "--json",
    ], repoRoot, { env: testAuthor.env }), "ask blocks unapproved test authoring");
    assert(unapprovedTest.data.run.tasks[0].attempts[0].testAuthoring.status === "fail", "ask remains closed without explicit authorization");
    assert(unapprovedTest.data.run.tasks[0].blocker.reasons.some((reason) => reason.includes("requires explicit approval")), "ask blocker names the missing decision");

    const askWithApproval = parseJson(runNode(cewpCli, [
      "supervise", "plan",
      "--goal", "Allow explicitly approved test authoring",
      "--scope", "tests/generated.test.js",
      "--verify", "git diff --check",
      "--stop", "The approved test file passes verification",
      "--test-authoring", "ask",
      "--json",
    ], repoRoot), "plan approved ask test-authoring fixture");
    const askWithApprovalId = askWithApproval.data.run.runId;
    const approvedTests = parseJson(runNode(cewpCli, [
      "supervise", "approve", askWithApprovalId,
      "--allow-test-authoring", "--yes", "--json",
    ], repoRoot), "explicitly approve test authoring");
    assert(approvedTests.data.run.approval.testAuthoringApproved === true, "ask approval is canonical run state");
    const authoredTest = parseJson(runNode(cewpCli, [
      "supervise", "execute", askWithApprovalId, "--yes", "--json",
    ], repoRoot, { env: testAuthor.env }), "execute approved test authoring");
    assert(authoredTest.data.run.tasks[0].attempts[0].testAuthoring.status === "pass", "explicit ask approval opens only the test-authoring gate");
    assert(authoredTest.data.run.tasks[0].attempts[0].scope.status === "pass", "approved test remains constrained by ordinary scope enforcement");

    const postDispatchPlan = parseJson(runNode(cewpCli, [
      "supervise", "plan",
      "--goal", "Recheck test policy at verification",
      "--scope", "README.md",
      "--scope", "tests/external.test.js",
      "--verify", "git diff --check",
      "--stop", "No test file enters a never-policy checkpoint",
      "--test-authoring", "never",
      "--json",
    ], repoRoot), "plan post-dispatch test-policy fixture");
    const postDispatchRunId = postDispatchPlan.data.run.runId;
    parseJson(runNode(cewpCli, [
      "supervise", "approve", postDispatchRunId, "--yes", "--json",
    ], repoRoot), "approve post-dispatch test-policy fixture");
    const postDispatchExecution = parseJson(runNode(cewpCli, [
      "supervise", "execute", postDispatchRunId, "--yes", "--json",
    ], repoRoot, { env: pass.env }), "execute post-dispatch test-policy fixture");
    const ownership = JSON.parse(fs.readFileSync(path.join(
      repoRoot, ".cewp", "supervised-runs", postDispatchRunId, "ownership.json",
    ), "utf8"));
    fs.mkdirSync(path.join(ownership.worktree.path, "tests"), { recursive: true });
    fs.writeFileSync(path.join(ownership.worktree.path, "tests", "external.test.js"), "throw new Error('must be blocked');\n");
    const postDispatchVerification = parseRejectedJson(runNode(cewpCli, [
      "supervise", "verify", postDispatchRunId, "--json",
    ], repoRoot), "verification rechecks test-authoring policy");
    assert(postDispatchExecution.data.run.tasks[0].attempts[0].testAuthoring.status === "pass", "worker attempt was policy-compliant before the external edit");
    assert(postDispatchVerification.data.run.status === "blocked", "a later test-file change cannot advance verification");
    assert(postDispatchVerification.data.run.tasks[0].blocker.code === "test-authoring-policy-violation", "verification records the hard policy blocker");

    const progress = fs.readFileSync(path.join(repoRoot, ".cewp", "supervised-runs", missingRunId, "progress.md"), "utf8");
    assert(!progress.includes("Reviewer: PASS"), "generated progress never fabricates reviewer PASS");
  } finally {
    for (const fake of [requestChanges, missingDecision, testAuthor, pass]) {
      fs.rmSync(fake.fakeRoot, { recursive: true, force: true });
    }
    cleanupRepo(repoRoot);
  }
}

try {
  runReviewerDecisionContract();
  console.log("[PASS] supervised reviewer and assurance gates remain truthful and recoverable");
} catch (error) {
  console.error("[FAIL] supervised reviewer/assurance contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
