"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo, readJson, runNode, writeJson } = require("../harness/lib/temp-repo");

const cewpCli = path.join(__dirname, "..", "..", "bin", "cewp.js");
const SECRET = "sk-abcdefghijklmnopqrstuvwxyz123456";

function runContract() {
  const repoRoot = makeTempRepo("cewp-pilot-export-");
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-pilot-export-outside-"));
  try {
    const created = runNode(cewpCli, [
      "pilot", "create",
      "--pilot-id", "dogfood-1",
      "--participant", "maintainer-dogfood",
      "--participant-id", "maintainer-1",
      "--json",
    ], repoRoot);
    assert(created.status === 0, `pilot fixture is created: ${created.stderr}`);
    const canonicalPath = path.join(repoRoot, ".cewp", "pilots", "dogfood-1", "record.json");
    const canonical = readJson(canonicalPath);
    canonical.adversarialFixture = {
      apiKey: SECRET,
      repositoryPath: "C:\\Users\\pilot\\private-repo",
      note: `<script>alert('pilot')</script> Bearer ${SECRET}`,
    };
    writeJson(canonicalPath, canonical);
    const canonicalBefore = fs.readFileSync(canonicalPath, "utf8");

    const exported = runNode(cewpCli, ["pilot", "export", "dogfood-1", "--json"], repoRoot);
    assert(exported.status === 0, `pilot export succeeds: ${exported.stderr}`);
    const output = JSON.parse(exported.stdout);
    assert(output.command === "pilot.export", "pilot export has a stable command envelope");
    assert(output.data.export.schemaVersion === "pilot-export/v1", "pilot export is versioned");
    assert(output.data.export.records.length === 1 && output.data.export.records[0].pilotId === "dogfood-1", "selected export contains only the requested pilot record");
    assert(output.data.export.redaction.applied === true && output.data.export.redaction.replacements >= 3, "export discloses applied redaction and replacement count");
    assert(output.data.export.redaction.canonicalRecordsModified === false, "redaction never claims to modify canonical records");
    assert(output.data.export.privacy.rawPromptsIncluded === false && output.data.export.privacy.rawLogsIncluded === false, "raw prompts and logs are excluded");

    const jsonPath = path.join(repoRoot, output.data.paths.json);
    const markdownPath = path.join(repoRoot, output.data.paths.markdown);
    assert(!path.isAbsolute(output.data.paths.json) && !output.data.paths.json.includes(".."), "export returns repository-relative contained paths");
    assert(fs.existsSync(jsonPath) && fs.existsSync(markdownPath), "separate JSON and Markdown exports are written");
    const exportedContents = `${fs.readFileSync(jsonPath, "utf8")}\n${fs.readFileSync(markdownPath, "utf8")}`;
    for (const sensitive of [SECRET, "C:\\Users\\pilot\\private-repo", "<script>"]) {
      assert(!exportedContents.includes(sensitive), `pilot export excludes ${sensitive}`);
    }
    assert(fs.readFileSync(canonicalPath, "utf8") === canonicalBefore, "canonical local pilot record is unchanged by export");

    const second = runNode(cewpCli, [
      "pilot", "create",
      "--pilot-id", "dogfood-2",
      "--participant", "maintainer-dogfood",
      "--participant-id", "maintainer-1",
      "--json",
    ], repoRoot);
    assert(second.status === 0, `second pilot fixture is created: ${second.stderr}`);
    const exportRoot = path.join(repoRoot, ".cewp", "pilot-exports");
    fs.mkdirSync(exportRoot, { recursive: true });
    fs.symlinkSync(outsideRoot, path.join(exportRoot, "dogfood-2"), process.platform === "win32" ? "junction" : "dir");
    const escaped = runNode(cewpCli, ["pilot", "export", "dogfood-2", "--json"], repoRoot);
    assert(escaped.status === 1 && escaped.stderr.includes("symbolic link"), "symlinked export roots fail closed");
    assert(!fs.existsSync(path.join(outsideRoot, "pilot-export.json")), "pilot export cannot escape through a symlink");
  } finally {
    cleanupRepo(repoRoot);
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
}

try {
  runContract();
  console.log("[PASS] pilot export is explicit, separate, and redacted");
} catch (error) {
  console.error("[FAIL] pilot redacted export contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
