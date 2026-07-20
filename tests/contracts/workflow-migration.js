"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const {
  cleanupRepo,
  makeTempRepo,
  runNode,
} = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");

function createApprovedLegacyRun(repoRoot) {
  const plannedResult = runNode(cewpCli, [
    "supervise", "plan",
    "--goal", "Migrate one bounded legacy checkpoint",
    "--scope", "src/example.js",
    "--verify", "node --test test/example.test.js",
    "--stop", "The migrated focused verification passes",
    "--json",
  ], repoRoot);
  assert(plannedResult.status === 0, `legacy migration fixture plans: ${plannedResult.stderr}`);
  const runId = JSON.parse(plannedResult.stdout).data.run.runId;
  const approvedResult = runNode(cewpCli, [
    "supervise", "approve", runId, "--yes", "--json",
  ], repoRoot);
  assert(approvedResult.status === 0, `legacy migration fixture approves: ${approvedResult.stderr}`);
  return runId;
}

function runWorkflowMigrationContract() {
  const repoRoot = makeTempRepo("cewp-workflow-migration-");
  try {
    const legacyRunId = createApprovedLegacyRun(repoRoot);
    const legacyRoot = path.join(repoRoot, ".cewp", "supervised-runs", legacyRunId);
    const legacyRunPath = path.join(legacyRoot, "run.json");
    const legacyProgressPath = path.join(legacyRoot, "progress.md");
    const sourceRunBytes = fs.readFileSync(legacyRunPath);
    const sourceProgressBytes = fs.readFileSync(legacyProgressPath);

    const compatibleStatusResult = runNode(cewpCli, [
      "workflow", "status", legacyRunId, "--json",
    ], repoRoot);
    assert(compatibleStatusResult.status === 0, `legacy run is readable through workflow status: ${compatibleStatusResult.stderr}`);
    const compatible = JSON.parse(compatibleStatusResult.stdout).data;
    assert(compatible.run.schemaVersion === "run-state/v2", "legacy status uses a v2 compatibility projection");
    assert(compatible.compatibility.sourceSchema === "supervised-run/v1", "projection identifies the source contract");
    assert(compatible.compatibility.readOnly === true, "compatibility projection is explicitly read-only");
    assert(Array.isArray(compatible.run.checkpointReviews), "legacy projection initializes checkpoint review history");
    assert(compatible.progress.nextAction.kind === "migration", "legacy projection exposes explicit migration as the safe action");
    assert(fs.readFileSync(legacyRunPath).equals(sourceRunBytes), "compatibility status cannot rewrite the legacy run");
    assert(fs.readFileSync(legacyProgressPath).equals(sourceProgressBytes), "compatibility status cannot regenerate legacy presentation files");

    const previewResult = runNode(cewpCli, [
      "workflow", "migrate", legacyRunId, "--json",
    ], repoRoot);
    assert(previewResult.status === 0, `legacy migration preview succeeds: ${previewResult.stderr}`);
    const preview = JSON.parse(previewResult.stdout);
    assert(preview.command === "workflow.migrate", "migration preview identifies the command");
    assert(preview.data.definition.schemaVersion === "workflow-definition/v1", "preview produces a validated workflow definition");
    assert(preview.data.migrationDigest.startsWith("sha256:"), "migration approval binds source and projected definition");
    assert(preview.data.approval.required === true, "migration requires explicit approval");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "migration-backups")), "preview creates no backup");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "migrations")), "preview creates no migration record");
    assert(fs.readFileSync(legacyRunPath).equals(sourceRunBytes), "preview leaves source bytes unchanged");

    const changedSource = JSON.parse(sourceRunBytes.toString("utf8"));
    changedSource.warnings.push("Simulate source drift after migration preview.");
    fs.writeFileSync(legacyRunPath, `${JSON.stringify(changedSource, null, 2)}\n`);
    const staleSource = runNode(cewpCli, [
      "workflow", "migrate", legacyRunId,
      "--digest", preview.data.migrationDigest,
      "--yes", "--json",
    ], repoRoot);
    assert(staleSource.status === 1, "source drift invalidates migration approval");
    assert(staleSource.stderr.includes("changed after preview"), "source drift requests a fresh migration preview");
    assert(!fs.existsSync(path.join(repoRoot, ".cewp", "migration-backups")), "stale approval creates no backup");
    fs.writeFileSync(legacyRunPath, sourceRunBytes);

    const missingDigest = runNode(cewpCli, [
      "workflow", "migrate", legacyRunId, "--yes", "--json",
    ], repoRoot);
    assert(missingDigest.status === 1, "migration application requires the previewed digest");

    const appliedResult = runNode(cewpCli, [
      "workflow", "migrate", legacyRunId,
      "--digest", preview.data.migrationDigest,
      "--yes", "--json",
    ], repoRoot);
    assert(appliedResult.status === 0, `approved legacy migration applies: ${appliedResult.stderr}`);
    const applied = JSON.parse(appliedResult.stdout).data;
    assert(applied.run.schemaVersion === "run-state/v2", "migration persists the current run contract");
    assert(applied.run.runId !== legacyRunId, "migration creates a distinct run identity");
    assert(applied.run.status === "approved", "approved legacy checkpoint remains ready, not completed");
    assert(Array.isArray(applied.run.checkpointReviews), "persisted migration initializes checkpoint review history");
    assert(applied.run.compatibility.migrationRequired === false, "persisted run records migration completion");
    assert(applied.run.compatibility.sourceRunId === legacyRunId, "persisted run links its source history");
    assert(fs.existsSync(path.join(repoRoot, applied.backupPath)), "migration creates a source backup");
    assert(fs.readFileSync(path.join(repoRoot, applied.backupPath)).equals(sourceRunBytes), "migration backup is byte-exact");
    assert(fs.existsSync(path.join(repoRoot, applied.migrationRecordPath)), "migration mapping is persisted separately");
    assert(fs.existsSync(path.join(repoRoot, applied.definitionPath)), "migration persists the projected definition");
    assert(fs.readFileSync(legacyRunPath).equals(sourceRunBytes), "migration never mutates the v1 source run");
    assert(fs.readFileSync(legacyProgressPath).equals(sourceProgressBytes), "migration never mutates v1 presentation");

    const migratedStatusResult = runNode(cewpCli, [
      "workflow", "status", applied.run.runId, "--json",
    ], repoRoot);
    assert(migratedStatusResult.status === 0, `migrated run is readable normally: ${migratedStatusResult.stderr}`);
    const migratedStatus = JSON.parse(migratedStatusResult.stdout).data;
    assert(migratedStatus.compatibility === null, "ordinary v2 status no longer uses a read-only projection");
    assert(migratedStatus.progress.nextAction.kind === "start", "migrated run can continue through the v2 scheduler");
    const startedResult = runNode(cewpCli, [
      "workflow", "start", applied.run.runId,
      "--task", "checkpoint-1", "--yes", "--json",
    ], repoRoot);
    assert(startedResult.status === 0, `migrated checkpoint starts: ${startedResult.stderr}`);

    const duplicate = runNode(cewpCli, [
      "workflow", "migrate", legacyRunId,
      "--digest", preview.data.migrationDigest,
      "--yes", "--json",
    ], repoRoot);
    assert(duplicate.status === 1, "the same legacy run cannot silently create duplicate migrations");
    assert(duplicate.stderr.includes("already migrated"), "duplicate refusal identifies the existing mapping");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runWorkflowMigrationContract();
  console.log("[PASS] supervised v1 migration is read-only until explicit backed-up approval");
} catch (error) {
  console.error("[FAIL] workflow migration contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
