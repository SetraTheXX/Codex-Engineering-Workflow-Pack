"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assert } = require("../harness/lib/assertions");

const fixtureRoot = path.join(__dirname, "..", "fixtures", "contracts");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));

function runFixtureContract() {
  const run = readJson("managed-run.json");
  const adapter = readJson("adapter-result.json");
  const filesystem = readJson("filesystem.json");
  const processResults = readJson("process-results.json");
  const events = fs.readFileSync(path.join(fixtureRoot, "events.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

  assert(run.owner === "managed" && run.backend === "codex-exec", "managed run fixture");
  assert(adapter.schemaVersion === "adapter-result/v1" && adapter.ok, "adapter fixture");
  assert(filesystem.files.some((file) => file.endsWith("agents/openai.yaml")), "filesystem fixture");
  assert(processResults.ordinaryFailure.crashed === false, "ordinary process failure fixture");
  assert(processResults.windowsNativeCrash.crashed === true, "native process crash fixture");
  assert(events.length === 2 && events[1].status === "paused-budget-safe", "event fixtures");
}

try {
  runFixtureContract();
  console.log("[PASS] deterministic run, adapter, event, filesystem, and process fixtures");
} catch (error) {
  console.error("[FAIL] deterministic fixture contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
