"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, runNode, writeFile } = require("../harness/lib/temp-repo");
const { validDefinition } = require("./workflow-definition");
const { approveWorkflow } = require("./workflow-scheduler");
const { loadWorkflowRun } = require("../../src/workflow/state");
const { exportRedactedEvidence, redactEvidenceValue } = require("../../src/evidence/redaction");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";

function runContract() {
  const synthetic = redactEvidenceValue({
    authorization: "Bearer top-secret-bearer",
    password: "hunter2",
    clientSecret: "client-secret-value",
    command: `tool --token=${SECRET} --count=2`,
    url: "https://alice:private@example.invalid/repo",
    privateBlock: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    absoluteWindowsPath: "C:\\Users\\Alice\\private\\notes.txt",
    traversalPath: "../../etc/passwd",
    dotenvPath: "config/.env",
    changedFiles: ["src/safe.js", "config/.env"],
    note: "See C:\\Users\\Alice\\private\\notes.txt before export",
    managedTokens: { label: "observed", value: 42 },
  });
  const serializedSynthetic = JSON.stringify(synthetic.value);
  for (const secret of ["top-secret-bearer", "hunter2", "client-secret-value", SECRET, "alice:private", "BEGIN PRIVATE KEY", "Users\\\\Alice", "../../etc/passwd", "config/.env"]) {
    assert(!serializedSynthetic.includes(secret), `redaction removes adversarial value ${secret}`);
  }
  assert(synthetic.value.managedTokens.value === 42, "non-secret usage token counts are preserved");
  assert(synthetic.value.changedFiles[0] === "src/safe.js" && synthetic.value.changedFiles[1] === "[REDACTED_PATH]", "path arrays preserve safe paths and redact sensitive paths");
  assert(synthetic.replacements >= 7, "redaction reports replacement count");

  const repoRoot = makeTempRepo("cewp-evidence-redaction-");
  try {
    const definition = validDefinition();
    definition.workflowId = "redacted-export";
    definition.goal = `Fix <script>alert('x')</script> using token=${SECRET}`;
    definition.tasks[0].verification.targeted[0] = `node test.js --password=hunter2`;
    const approved = approveWorkflow(repoRoot, definition);
    const found = loadWorkflowRun(repoRoot, approved.runId);
    writeFile(path.join(found.runRoot, "adapter-output", "prompt.md"), "RAW_PROMPT_DO_NOT_EXPORT\n");
    const exported = exportRedactedEvidence(found, { generatedAt: "2026-07-22T14:00:00.000Z" });
    assert(exported.receipt.schemaVersion === "evidence-receipt/v1", "redacted export preserves receipt contract");
    assert(exported.receipt.redaction.schemaVersion === "redaction-policy/v1" && exported.receipt.redaction.applied, "redaction is explicit and versioned");
    assert(exported.report.schemaVersion === "operator-report/v1", "redacted export preserves report contract");
    assert(Object.values(exported.paths).every((entry) => !path.isAbsolute(entry) && !entry.includes("..")), "export returns repository-relative paths");
    const contents = Object.values(exported.paths).map((relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8")).join("\n");
    for (const secret of [SECRET, "hunter2", "RAW_PROMPT_DO_NOT_EXPORT", "<script>alert('x')</script>"]) {
      assert(!contents.includes(secret), `export excludes ${secret}`);
    }
    assert(!/https?:\/\//.test(fs.readFileSync(path.join(repoRoot, exported.paths.html), "utf8")), "redacted HTML remains offline");
    assert(contents.includes("Redaction") && contents.includes("redaction-policy/v1"), "export artifacts disclose that redaction was applied");
    assert(!fs.existsSync(path.join(found.runRoot, "evidence-receipt.json")), "export does not overwrite or create the canonical receipt");

    const cli = runNode(cewpCli, ["workflow", "export", approved.runId, "--json"], repoRoot);
    assert(cli.status === 0, `workflow export CLI succeeds: ${cli.stderr}`);
    const output = JSON.parse(cli.stdout);
    assert(output.command === "workflow.export" && output.data.receipt.redaction.applied, "CLI emits only the redacted export model");
    assert(!cli.stdout.includes(SECRET) && !cli.stdout.includes(repoRoot), "CLI JSON does not leak secrets or absolute repository paths");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] adversarial evidence redaction and safe export");
} catch (error) {
  console.error("[FAIL] evidence redaction contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
