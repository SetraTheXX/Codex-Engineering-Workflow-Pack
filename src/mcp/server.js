"use strict";

const readline = require("node:readline");
const { TOOLS, callTool } = require("./tools");

const PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);

function packageVersion() {
  try {
    return require("../../package.json").version;
  } catch {
    return "unknown";
  }
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: false,
  };
}

function toolError(error) {
  return {
    content: [{ type: "text", text: error && error.message ? error.message : String(error) }],
    isError: true,
  };
}

function createMcpSession(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  let initialized = false;

  function handle(message) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return rpcError(message && message.id !== undefined ? message.id : null, -32600, "Invalid JSON-RPC request.");
    }
    if (message.method === "notifications/initialized" || message.method.startsWith("notifications/")) {
      return null;
    }
    if (message.method === "initialize") {
      const requested = message.params && message.params.protocolVersion;
      const compatible = PROTOCOL_VERSIONS.has(requested);
      const protocolVersion = compatible ? requested : "2025-11-25";
      initialized = true;
      return response(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "cewp-local-core",
          version: packageVersion(),
          description: "Local CEWP Core tools with supervised approval and evidence gates.",
        },
        instructions: "Inspect before mutating. Explicit confirmation does not bypass CEWP Core state, ownership, scope, policy, budget, verification, or reviewer gates.",
        compatibility: compatible
          ? { compatible: true, requestedProtocolVersion: requested, fallback: null, warning: null }
          : {
            compatible: false,
            requestedProtocolVersion: requested || null,
            fallback: "cewp-cli-operator-json",
            warning: {
              code: "mcp-protocol-version-drift",
              message: `Requested MCP protocol ${requested || "unknown"} is unsupported; negotiated ${protocolVersion}. Disconnect or use the CEWP CLI operator JSON fallback.`,
            },
          },
      });
    }
    if (!initialized) return rpcError(message.id, -32002, "MCP session is not initialized.");
    if (message.method === "ping") return response(message.id, {});
    if (message.method === "tools/list") return response(message.id, { tools: TOOLS });
    if (message.method === "tools/call") {
      const params = message.params;
      if (!params || typeof params.name !== "string") {
        return rpcError(message.id, -32602, "tools/call requires a tool name.");
      }
      try {
        return response(message.id, toolResult(callTool(params.name, params.arguments || {}, { repoRoot })));
      } catch (error) {
        if (error && error.code === -32602) return rpcError(message.id, -32602, error.message);
        return response(message.id, toolError(error));
      }
    }
    return rpcError(message.id, -32601, `Method not found: ${message.method}`);
  }

  return { handle };
}

function runStdio(options = {}) {
  const session = createMcpSession(options);
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "Parse error."))}\n`);
      return;
    }
    const result = session.handle(message);
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  });
}

module.exports = { createMcpSession, runStdio };
