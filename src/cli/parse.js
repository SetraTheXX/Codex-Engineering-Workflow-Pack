"use strict";

function parseAgeToMs(value) {
  const match = String(value || "").match(/^(\d+)([dhm])$/);

  if (!match) {
    throw new Error("--older-than requires an age like 7d, 24h, or 30m.");
  }

  const amount = Number.parseInt(match[1], 10);

  if (amount <= 0) {
    throw new Error("--older-than requires a positive age.");
  }

  const unit = match[2];
  const multipliers = {
    d: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    m: 60 * 1000,
  };

  return amount * multipliers[unit];
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    subcommand: argv[1],
    role: argv[2],
    action: argv[2],
    runId: undefined,
    mode: "repo",
    target: undefined,
    targetProvided: false,
    force: false,
    help: false,
    dryRun: false,
    yes: false,
    adapter: undefined,
    timeoutSeconds: 120,
    keepRuns: undefined,
    olderThanMs: undefined,
    olderThanRaw: undefined,
    policyMode: undefined,
    parallel: false,
    workers: undefined,
    reviewer: false,
    withConfig: false,
    fromFile: undefined,
    limit: undefined,
    json: false,
    goal: undefined,
    scopes: [],
    verificationCommands: [],
    fullVerificationCommands: [],
    stoppingConditions: [],
    assurance: undefined,
    testAuthoring: undefined,
    proposalFile: undefined,
    sourceKind: undefined,
    reason: undefined,
    note: undefined,
    operations: undefined,
    allocation: undefined,
    definitionFile: undefined,
  };

  if (argv[0] === "--help" || argv[0] === "-h") {
    args.command = undefined;
    args.help = true;
    return args;
  }

  if (argv[0] === "help") {
    args.command = undefined;
    args.help = true;
    return args;
  }

  if (argv[0] === "run" && (argv[1] === "--help" || argv[1] === "-h" || argv[1] === "help")) {
    args.help = true;
    return args;
  }

  const optionStart = ["run", "supervise", "workflow", "demo"].includes(args.command) ? 2 : 1;

  for (let index = optionStart; index < argv.length; index += 1) {
    const arg = argv[index];

    if (args.command === "run" && args.subcommand === "prompt" && index === 2) {
      args.role = arg;
      continue;
    }

    if (args.command === "run" && ["status", "next", "resume"].includes(args.subcommand) && index === 2 && !arg.startsWith("--")) {
      args.runId = arg;
      continue;
    }

    if (args.command === "run" && args.subcommand === "worktrees" && index === 2) {
      args.action = arg;
      continue;
    }

    if (args.command === "run" && args.subcommand === "dispatch" && index === 2) {
      args.action = arg;
      continue;
    }

    if (args.command === "run" && args.subcommand === "dispatch" && ["exec", "complete"].includes(args.action) && index === 3) {
      args.role = arg;
      continue;
    }

    if (args.command === "policy" && index === 1) {
      args.subcommand = arg;
      continue;
    }

    if (args.command === "workflow" && args.subcommand === "validate" && index === 2 && !arg.startsWith("--")) {
      args.definitionFile = arg;
      continue;
    }

    if (args.command === "policy" && args.subcommand === "set" && index === 2) {
      args.policyMode = arg;
      continue;
    }

    if (
      args.command === "supervise"
      && [
        "approve", "status", "execute", "verify", "retry", "review", "receipt", "finalize",
        "revise", "pause", "resume", "add-budget", "rollback", "cancel", "abandon", "block", "continue", "reassign",
      ].includes(args.subcommand)
      && index === 2
      && !arg.startsWith("--")
    ) {
      args.runId = arg;
      continue;
    }

    if (args.command === "supervise" && arg === "--goal") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--goal requires text.");
      }
      args.goal = value;
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--proposal") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--proposal requires a repository-relative JSON file.");
      }
      args.proposalFile = value;
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--source-kind") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--source-kind requires issue, prd, plan, progress, or direct-goal.");
      }
      args.sourceKind = value;
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--reason") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--reason requires text.");
      }
      args.reason = value;
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--note") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--note requires text.");
      }
      args.note = value;
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--operations") {
      const value = argv[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("--operations requires a positive integer.");
      }
      args.operations = Number.parseInt(value, 10);
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--allocation") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--allocation requires an allocation name.");
      }
      args.allocation = value;
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--scope") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--scope requires a repository-relative path.");
      }
      args.scopes.push(value);
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--verify") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--verify requires a command.");
      }
      args.verificationCommands.push(value);
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--full-verify") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--full-verify requires a command.");
      }
      args.fullVerificationCommands.push(value);
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--stop") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--stop requires a stopping condition.");
      }
      args.stoppingConditions.push(value);
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--assurance") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--assurance requires prototype, standard, or critical.");
      }
      args.assurance = value;
      index += 1;
      continue;
    }

    if (args.command === "supervise" && arg === "--test-authoring") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--test-authoring requires auto, ask, or never.");
      }
      args.testAuthoring = value;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--mode") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--mode requires repo or global.");
      }
      args.mode = value;
      index += 1;
      continue;
    }

    if (arg === "--target") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--target requires a path argument.");
      }
      args.target = value;
      args.targetProvided = true;
      index += 1;
      continue;
    }

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    if (args.command === "init" && arg === "--with-config") {
      args.withConfig = true;
      continue;
    }

    if (args.command === "run" && arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (["doctor", "run", "supervise", "workflow", "demo"].includes(args.command) && arg === "--json") {
      args.json = true;
      continue;
    }

    if (args.command === "supervise" && arg === "--yes") {
      args.yes = true;
      continue;
    }

    if (args.command === "supervise" && arg === "--allow-test-authoring") {
      args.allowTestAuthoring = true;
      continue;
    }

    if (args.command === "run" && arg === "--yes") {
      args.yes = true;
      continue;
    }

    if (args.command === "run" && arg === "--parallel") {
      args.parallel = true;
      continue;
    }

    if (args.command === "run" && arg === "--workers") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("cewp run init --workers 2 --reviewer is the supported v0.2 shape.");
      }
      if (!/^\d+$/.test(value)) {
        throw new Error("cewp run init --workers 2 --reviewer is the supported v0.2 shape.");
      }
      args.workers = Number.parseInt(value, 10);
      index += 1;
      continue;
    }

    if (args.command === "run" && arg === "--reviewer") {
      args.reviewer = true;
      continue;
    }

    if (args.command === "run" && arg === "--run") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--run requires a run id.");
      }
      args.runId = value;
      index += 1;
      continue;
    }

    if (args.command === "run" && arg === "--adapter") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--adapter requires an adapter name.");
      }
      args.adapter = value;
      index += 1;
      continue;
    }

    if (["run", "supervise"].includes(args.command) && arg === "--from") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--from requires a file path.");
      }
      args.fromFile = value;
      index += 1;
      continue;
    }

    if (["run", "supervise"].includes(args.command) && arg === "--timeout") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || !/^\d+$/.test(value)) {
        throw new Error("--timeout requires a positive number of seconds.");
      }
      args.timeoutSeconds = Number.parseInt(value, 10);
      if (args.timeoutSeconds <= 0) {
        throw new Error("--timeout requires a positive number of seconds.");
      }
      index += 1;
      continue;
    }

    if (args.command === "run" && arg === "--keep") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || !/^\d+$/.test(value)) {
        throw new Error("--keep requires a positive integer.");
      }
      args.keepRuns = Number.parseInt(value, 10);
      if (args.keepRuns <= 0) {
        throw new Error("--keep requires a positive integer.");
      }
      index += 1;
      continue;
    }

    if (args.command === "run" && arg === "--limit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || !/^\d+$/.test(value)) {
        throw new Error("--limit requires a positive integer.");
      }
      args.limit = Number.parseInt(value, 10);
      if (args.limit <= 0) {
        throw new Error("--limit requires a positive integer.");
      }
      index += 1;
      continue;
    }

    if (args.command === "run" && arg === "--older-than") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--older-than requires an age like 7d, 24h, or 30m.");
      }
      args.olderThanRaw = value;
      args.olderThanMs = parseAgeToMs(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

module.exports = {
  parseArgs,
};
