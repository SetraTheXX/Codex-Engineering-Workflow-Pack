# CEWP Codex Plugin

This thin plugin exposes CEWP's Phase 9 supervised workflow through supported Codex discovery and conversation surfaces. The local `cewp` CLI/runtime remains authoritative for run state, scope, policy, budget enforcement, verification, reviewer PASS, and finalization.

It ships exactly three entry skills:

- `plan-supervised-run`: propose and validate one bounded checkpoint before approval.
- `run-supervised-checkpoint`: execute one controlled model operation and follow Core gates.
- `resume-supervised-run`: inspect or recover canonical state without silently restarting work.

The plugin does not attach to the ChatGPT desktop app's private thread, automate native goals, inject persistent UI, expose hidden host usage, execute the optional OpenCode adapter, or add another provider. Phase 9 uses one selected pair: `managed` owner with the `codex-exec` backend.

Install from the CEWP source marketplace:

```bash
codex plugin marketplace add /path/to/Codex-Engineering-Workflow-Pack
codex plugin add cewp@cewp-local
```

The npm package supplies the `cewp` runtime used by these skills. Run `cewp doctor --json` before the first supervised checkpoint.
