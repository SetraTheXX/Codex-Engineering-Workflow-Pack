# CEWP Codex Plugin

This thin plugin exposes CEWP's Phase 9 supervised workflow through supported Codex discovery and conversation surfaces. The local `cewp` CLI/runtime remains authoritative for run state, scope, policy, budget enforcement, verification, checkpoint snapshots, reviewer PASS, and finalization. A run has one active checkpoint at a time and may continue linearly only after fresh operator approval.

It ships exactly three entry skills:

- `plan-supervised-run`: propose and validate one bounded checkpoint before approval.
- `run-supervised-checkpoint`: execute one controlled model operation and follow Core gates.
- `resume-supervised-run`: inspect or recover canonical state without silently restarting work.

The plugin does not attach to the ChatGPT desktop app's private thread, automate native goals, inject persistent UI, expose hidden host usage, execute the optional OpenCode adapter, or add another provider. The managed path uses one selected pair: `managed` owner with the `codex-exec` backend.

## Local MCP Tools

The plugin declares one local stdio server backed by the npm package's `cewp-mcp` command. It exposes
create, inspect, approve, continue, retry, revise, verify, and finalize as structured tools. The server fixes
repository scope to its working directory and imports the same CEWP Core services as the CLI. MCP host
consent never replaces Core approval, ownership, policy, effort, scope, budget, verification, receipt, or
independent-review gates.

## Optional Subagent Evidence

The plugin declares one `SubagentStart`/`SubagentStop` hook bundle. Installation or enablement does not trust it. For a selected workflow run, first inspect the bundle and activate the CEWP-side binding:

```bash
cewp integration hooks approve <workflow-run-id> --yes --json
```

Then open `/hooks` in Codex, review the exact current definition, and decide whether to trust it. `cewp integration hooks status <workflow-run-id> --json` reports bundle, Codex, CEWP runtime, hook-contract, and workflow-revision drift. A changed or malformed source produces a warning and no trusted evidence.

The hook records bounded parent session/turn references, the documented subagent id/type, and the stop summary in a provider-specific sidecar. The documented hook input does not expose a subagent thread id, so that field remains `unknown`. The handler never reads transcript files, never blocks or continues a subagent, and never opens a policy, verification, review, or finalization gate.

Install from the CEWP source marketplace:

```bash
codex plugin marketplace add /path/to/Codex-Engineering-Workflow-Pack
codex plugin add cewp@cewp-local
```

The npm package supplies the `cewp` runtime used by the skills and optional evidence handler. Run `cewp doctor --json` before the first supervised checkpoint.
