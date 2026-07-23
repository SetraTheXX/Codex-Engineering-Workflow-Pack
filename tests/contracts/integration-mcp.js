"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { assert } = require("../harness/lib/assertions");
const { cleanupRepo, makeTempRepo } = require("../harness/lib/temp-repo");

const mcpBin = path.join(__dirname, "..", "..", "bin", "cewp-mcp.js");

function request(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
}

function runMcp(repoRoot, messages) {
  const result = spawnSync(process.execPath, [mcpBin], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${messages.join("\n")}\n`,
  });
  assert(result.status === 0, `MCP server exits cleanly: ${result.stderr}`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function call(id, name, args = {}) {
  return request(id, "tools/call", { name, arguments: args });
}

function runContract() {
  const repoRoot = makeTempRepo("cewp-integration-mcp-");
  try {
    const responses = runMcp(repoRoot, [
      request(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "cewp-contract", version: "1.0.0" },
      }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      request(2, "tools/list", {}),
      call(3, "cewp_create", {
        goal: "Update the bounded file",
        scopes: ["README.md"],
        verificationCommands: ["git diff --check"],
        stoppingConditions: ["The diff check passes"],
      }),
    ]);

    assert(responses.length === 3, "notifications do not receive responses");
    assert(responses[0].result.protocolVersion === "2025-11-25", "supported protocol is negotiated");
    assert(responses[0].result.capabilities.tools, "server advertises tools capability");
    const names = responses[1].result.tools.map((tool) => tool.name);
    assert(JSON.stringify(names) === JSON.stringify([
      "cewp_create", "cewp_inspect", "cewp_approve", "cewp_continue",
      "cewp_retry", "cewp_revise", "cewp_verify", "cewp_finalize",
    ]), "MCP exposes only the eight roadmap operations");
    const inspectTool = responses[1].result.tools.find((tool) => tool.name === "cewp_inspect");
    assert(inspectTool.annotations.readOnlyHint === false, "inspect truthfully declares its generated progress refresh");
    assert(responses[2].result.isError !== true, "create succeeds through MCP");
    const created = responses[2].result.structuredContent;
    assert(created.run.status === "proposed", "create calls the supervised Core proposal service");
    assert(created.run.repo.root === repoRoot, "repository root is fixed to the MCP process cwd");

    const runId = created.run.runId;
    const gates = runMcp(repoRoot, [
      request(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cewp-contract", version: "1.0.0" },
      }),
      call(2, "cewp_inspect", { runId }),
      call(3, "cewp_approve", { runId, confirm: false }),
      call(4, "cewp_approve", { runId, confirm: true }),
      call(5, "cewp_continue", { runId }),
      call(6, "cewp_retry", { runId, confirm: false }),
      call(7, "cewp_revise", { runId, goal: "Revised goal" }),
      call(8, "cewp_verify", { runId }),
      call(9, "cewp_finalize", { runId, confirm: false }),
      call(10, "not_a_cewp_tool", {}),
      call(11, "cewp_inspect", { runId: 7 }),
    ]);

    assert(gates[1].result.structuredContent.run.status === "proposed", "inspect uses Core state inspection");
    assert(gates[2].result.isError === true && gates[2].result.content[0].text.includes("explicit confirmation"), "approve requires MCP confirmation");
    assert(gates[3].result.structuredContent.run.status === "approved", "confirmed approve reaches Core approval");
    assert(gates[4].result.isError === true && gates[4].result.content[0].text.includes("verified checkpoint"), "continue preserves checkpoint gate");
    assert(gates[5].result.isError === true && gates[5].result.content[0].text.includes("explicit confirmation"), "retry requires MCP confirmation before Core dispatch");
    assert(gates[6].result.structuredContent.run.status === "proposed", "revise calls Core and invalidates approval");
    assert(gates[7].result.isError === true && gates[7].result.content[0].text.includes("cannot verify"), "verify preserves Core state gate");
    assert(gates[8].result.isError === true && gates[8].result.content[0].text.includes("explicit confirmation"), "finalize requires MCP confirmation");
    assert(gates[9].error.code === -32602 && gates[9].error.message.includes("Unknown tool"), "unknown tools are protocol errors");
    assert(gates[10].error.code === -32602 && gates[10].error.message.includes("input schema"), "malformed tool arguments are protocol errors");
  } finally {
    cleanupRepo(repoRoot);
  }
}

try {
  runContract();
  console.log("[PASS] local MCP tools share supervised Core gates");
} catch (error) {
  console.error("[FAIL] local MCP integration contract");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
