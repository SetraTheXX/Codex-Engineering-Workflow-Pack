#!/usr/bin/env node

const { runCleanup } = require("../src/run/cleanup");
const { runPrune } = require("../src/run/prune");
const { runPolicy } = require("../src/run/policy");
const {
  runWorktreesPlan,
  runWorktreesCreate,
  runWorktreesStatus,
} = require("../src/run/worktrees");
const {
  runInit,
  runList,
  runStatus,
  runNext,
  runPrompts,
  runPrompt,
} = require("../src/run/basic");
const { runFinalize } = require("../src/run/finalize");
const { runCollect } = require("../src/run/collect");
const { runDispatchPlan } = require("../src/run/dispatch/plan");
const { runDispatchCheck } = require("../src/run/dispatch/check");
const { runDispatchPrompts } = require("../src/run/dispatch/prompts");
const { runDispatchStart } = require("../src/run/dispatch/start");
const { runDispatchComplete } = require("../src/run/dispatch/complete");
const { runDispatchExec: runSingleDispatchExec } = require("../src/run/dispatch/exec");
const { runDispatchWorkers } = require("../src/run/dispatch/workers");
const { runDispatchPipeline } = require("../src/run/dispatch/pipeline");
const { usage } = require("../src/cli/usage");
const { parseArgs } = require("../src/cli/parse");
const { printCliError } = require("../src/cli/errors");
const { init } = require("../src/skills/install");
const { list, doctor } = require("../src/skills/status");

async function runCommand(options) {
  if (options.help || !options.subcommand) {
    usage();
    return;
  }

  if (options.subcommand === "init") {
    runInit(options);
    return;
  }

  if (options.subcommand === "list") {
    runList(options);
    return;
  }

  if (options.subcommand === "status") {
    runStatus(options);
    return;
  }

  if (options.subcommand === "next") {
    runNext(options);
    return;
  }

  if (options.subcommand === "prompts") {
    runPrompts(options);
    return;
  }

  if (options.subcommand === "prompt") {
    runPrompt(options.role, options);
    return;
  }

  if (options.subcommand === "collect") {
    runCollect(options);
    return;
  }

  if (options.subcommand === "finalize") {
    runFinalize(options);
    return;
  }

  if (options.subcommand === "cleanup") {
    runCleanup(options);
    return;
  }

  if (options.subcommand === "prune") {
    runPrune(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "plan") {
    runWorktreesPlan(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "create") {
    runWorktreesCreate(options);
    return;
  }

  if (options.subcommand === "worktrees" && options.action === "status") {
    runWorktreesStatus(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "plan") {
    runDispatchPlan(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "check") {
    runDispatchCheck(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "prompts") {
    runDispatchPrompts(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "start") {
    runDispatchStart(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "exec") {
    if (options.role === "workers") {
      await runDispatchWorkers(options);
    } else {
      await runSingleDispatchExec(options);
    }
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "complete") {
    runDispatchComplete(options);
    return;
  }

  if (options.subcommand === "dispatch" && options.action === "pipeline") {
    await runDispatchPipeline(options);
    return;
  }

  throw new Error(`Unsupported run command: ${options.subcommand}`);
}

async function main() {
  const rawArgs = process.argv.slice(2);

  try {
    const args = parseArgs(rawArgs);

    if (!args.command || args.help) {
      usage();
      return;
    }

    if (args.command === "init") {
      init(args);
      return;
    }

    if (args.command === "list") {
      list(args);
      return;
    }

    if (args.command === "doctor") {
      doctor(args);
      return;
    }

    if (args.command === "policy") {
      runPolicy(args);
      return;
    }

    if (args.command === "run") {
      await runCommand(args);
      return;
    }

    if (!["init", "list", "doctor", "policy", "run"].includes(args.command)) {
      throw new Error(`Unsupported command: ${args.command}`);
    }
  } catch (error) {
    printCliError(error, rawArgs);
    process.exitCode = 1;
  }
}

main();
