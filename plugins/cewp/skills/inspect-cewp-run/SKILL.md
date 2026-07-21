---
name: inspect-cewp-run
description: Inspect CEWP installation readiness, existing run state, generated progress, or the next safe operator action without dispatching a model or mutating a run. Use when the user asks what CEWP is doing, whether it is ready, how to resume, or what should happen next.
---

# Inspect A CEWP Run

Use the installed CEWP Core CLI as the source of truth. This skill is a thin read-only entry point, not an execution engine.

1. Run `cewp doctor` when installation or provider readiness is in question.
2. Run `cewp run list --json` to discover runs without guessing an id.
3. Run `cewp run status --run <id> --json` for canonical state and evidence.
4. Run `cewp run resume --run <id> --json` for the generated progress and safe next action.
5. Explain the result in the conversation. Keep binary readiness separate from authentication and model readiness.

Do not execute the suggested command, create or clean worktrees, start a provider, or finalize a run unless the user explicitly switches to an approved execution workflow. Do not imply control of a native ChatGPT/Codex goal or hidden host usage.
