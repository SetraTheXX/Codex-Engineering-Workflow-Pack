"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const REQUEST_TIMEOUT_MS = 15000;

class AppServerClient {
  constructor({ command, env }) {
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = new Set();
    this.stderr = "";
    this.proc = childProcess.spawn(command, ["app-server", "--stdio"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4000);
    });
    this.proc.on("error", (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
    this.proc.on("exit", (code, signal) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`app-server exited before responding (${code || signal})`));
      }
      this.pending.clear();
    });

    this.lines = readline.createInterface({ input: this.proc.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
  }

  handleLine(line) {
    const message = JSON.parse(line);
    if (message.method && message.id === undefined) {
      this.notifications.add(message.method);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || "app-server request failed");
      error.rpcCode = message.error.code;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  send(message) {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ method, id, params });
    });
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "cewp_capability_probe",
        title: "CEWP Capability Probe",
        version: "0.1.0",
      },
    });
    this.send({ method: "initialized", params: {} });
  }

  close() {
    this.lines.close();
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function classifyRequest(client, method, params = {}) {
  try {
    const result = await client.request(method, params);
    return { status: "supported", result };
  } catch (error) {
    return {
      status: "unavailable",
      errorCode: error.rpcCode === undefined ? null : error.rpcCode,
      reason: /not logged in|authentication|auth/i.test(error.message)
        ? "authentication-required"
        : /method not found|unknown method/i.test(error.message)
          ? "method-unavailable"
          : "request-rejected",
    };
  }
}

function publicResult(status, extra = {}) {
  return {
    status: status.status,
    ...(status.errorCode === undefined ? {} : { errorCode: status.errorCode }),
    ...(status.reason ? { reason: status.reason } : {}),
    ...extra,
  };
}

async function runProbe() {
  const command = process.env.CEWP_CODEX_COMMAND || "codex";
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "cewp-codex-home-"));
  const env = {
    ...process.env,
    CODEX_HOME: isolatedHome,
  };

  let firstClient;
  let secondClient;
  try {
    const version = childProcess.spawnSync(command, ["--version"], {
      env,
      encoding: "utf8",
      windowsHide: true,
    });
    if (version.status !== 0) {
      throw new Error("Codex CLI is unavailable.");
    }

    firstClient = new AppServerClient({ command, env });
    await firstClient.initialize();
    const account = await classifyRequest(firstClient, "account/read", { refreshToken: false });
    const rateLimits = await classifyRequest(firstClient, "account/rateLimits/read", null);
    const accountUsage = await classifyRequest(firstClient, "account/usage/read", null);
    const started = await firstClient.request("thread/start", {
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: false,
    });
    const threadId = started.thread.id;
    const goalSet = await classifyRequest(firstClient, "thread/goal/set", {
      threadId,
      objective: "Probe persisted goal lifecycle without starting a model turn.",
      status: "active",
      tokenBudget: 1000,
    });
    const goalPaused = await classifyRequest(firstClient, "thread/goal/set", {
      threadId,
      status: "paused",
    });
    firstClient.close();
    firstClient = undefined;

    secondClient = new AppServerClient({ command, env });
    await secondClient.initialize();
    const resumed = await classifyRequest(secondClient, "thread/resume", {
      threadId,
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    const goalGet = await classifyRequest(secondClient, "thread/goal/get", { threadId });
    const goalClear = await classifyRequest(secondClient, "thread/goal/clear", { threadId });

    return {
      schemaVersion: "cewp-capability-probe/v1",
      generatedAt: new Date().toISOString(),
      codexVersion: String(version.stdout || "").trim(),
      executionOwner: "managed",
      backend: "app-server",
      transport: "stdio",
      authenticationBoundary: "isolated CODEX_HOME without copied credentials",
      modelTurnStarted: false,
      capabilities: {
        initialize: { status: "supported" },
        threadStart: { status: "supported", persistedInIsolatedHome: true },
        threadResume: publicResult(resumed),
        goalSet: publicResult(goalSet, {
          tokenBudgetRoundTrip: goalSet.result?.goal?.tokenBudget === 1000,
        }),
        goalStatusUpdate: publicResult(goalPaused, {
          pausedRoundTrip: goalPaused.result?.goal?.status === "paused",
        }),
        goalGet: publicResult(goalGet, {
          pausedRoundTrip: goalGet.result?.goal?.status === "paused",
        }),
        goalClear: publicResult(goalClear),
        accountRead: publicResult(account, {
          authenticated: Boolean(account.result?.account),
        }),
        accountRateLimitsRead: publicResult(rateLimits),
        accountUsageRead: publicResult(accountUsage),
        threadTokenUsageEvents: {
          status: "unknown",
          reason: "no-model-turn-started",
        },
        turnInterrupt: {
          status: "unknown",
          reason: "no-model-turn-started",
        },
      },
      observedNotificationMethods: Array.from(secondClient.notifications).sort(),
    };
  } finally {
    if (firstClient) {
      firstClient.close();
    }
    if (secondClient) {
      secondClient.close();
    }
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
}

runProbe()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
