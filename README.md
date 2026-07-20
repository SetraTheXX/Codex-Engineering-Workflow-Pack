# Codex Engineering Workflow Pack

[![npm version](https://img.shields.io/npm/v/@setrathex/codex-engineering-workflow-pack?tag=latest)](https://www.npmjs.com/package/@setrathex/codex-engineering-workflow-pack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Long-running goals without blind runs.**

CEWP is an unofficial, local-first supervision layer for risky or long-running Codex work. Codex still writes the code. CEWP adds a bounded plan, an isolated worktree, scope and policy gates, deterministic verification, explicit repair limits, an independent reviewer, and a portable receipt.

It is not another chat client, model router, or endless agent loop. It does not attach to a private ChatGPT task, patch the desktop UI, or make a model intrinsically faster.

## Native Goal Or CEWP?

Use a native Codex goal alone when the task is small, low risk, easy to inspect, and interruption is unlikely to cost much.

Use CEWP when you need one or more of these:

- approved scope and stopping conditions before execution,
- a hard limit on worker, repair, and reviewer operations,
- safe pause and resume evidence,
- deterministic tests outside the model loop,
- an independent reviewer PASS before finalization,
- a receipt that explains what changed and what remains unknown.

CEWP currently selects one golden-path pair: execution owner `managed`, backend `codex-exec`. Experimental OpenCode support remains optional and is not part of this path.

## Five-Minute Start

Requirements: maintained Node.js 22 or newer, Git, and Codex CLI for managed execution.

```bash
npm install -g @setrathex/codex-engineering-workflow-pack
cewp init
cewp doctor
```

Run the credential-free deterministic walkthrough first:

```bash
cewp demo supervised
```

In a disposable or reviewed repository, create one bounded checkpoint:

```bash
cewp supervise plan \
  --goal "Update the install example" \
  --scope README.md \
  --verify "git diff --check" \
  --stop "The install example is accurate and the approved check passes"
```

Inspect the preview, then explicitly approve it. Managed worker, reviewer, and finalize operations require the advanced local policy; this does not disable scope, verification, budget, or reviewer gates.

```bash
cewp policy set full-authority
cewp supervise approve <run-id> --yes
cewp supervise execute <run-id> --yes
cewp supervise verify <run-id>
cewp supervise continue <run-id>
cewp supervise review <run-id> --yes
cewp supervise receipt <run-id>
cewp supervise finalize <run-id> --yes
```

Nothing in that flow merges, pushes, publishes, tags, or creates a release.

## Codex Plugin

The thin plugin contributes exactly three conversational skills. CEWP Core and the CLI remain authoritative.

From a source checkout:

```bash
codex plugin marketplace add /path/to/Codex-Engineering-Workflow-Pack
codex plugin add cewp@cewp-local
codex plugin list
```

Then ask Codex to plan a supervised run, run the current checkpoint, or resume an existing run. The plugin does not gain direct access to the host's private thread, native goal lifecycle, billing data, or persistent UI.

## What CEWP Records

Phase 9 supervised state lives under `.cewp/supervised-runs/<run-id>/`; graph workflow state lives under `.cewp/workflow-runs/<run-id>/`. Human-readable `progress.md` is generated from canonical state and cannot silently change it.

CEWP keeps four truth labels separate:

- `observed`: reported by a supported structured interface,
- `estimated`: a range learned from enough comparable local runs,
- `budgeted`: an approved CEWP-controlled maximum,
- `unknown`: unavailable from the selected host or authentication boundary.

ChatGPT subscription usage is not converted into a fabricated per-run dollar value. A soft estimate never pretends to be an exact mid-turn token cap.

## Assurance And Recovery

The `prototype`, `standard`, and `critical` profiles set bounded operation, repair, elapsed-time, verification, and reserve envelopes. `standard` is the default with one worker and at most two repairs per checkpoint.

Test authoring is separate from verification:

- `auto`: tests may change inside approved scope,
- `ask`: test changes require `approve --allow-test-authoring --yes`,
- `never`: Core blocks detectable test-file changes, while approved non-test verification still runs.

Budget or host exhaustion produces a resumable pause, not a fake PASS. Partial files remain isolated and cannot finalize without verification and reviewer PASS.

## Existing Toolkit

CEWP still ships ten reusable engineering skills and the earlier Coordinator Mode runtime for compatibility. The supervised path remains the managed `codex-exec` golden path. The workflow runtime adds source-bound compiler requests, approved task graphs, variable workers, result intake, recovery, revisions, and migrations without executing arbitrary prose or adding another backend.

## Documentation

- [Install Guide](docs/install.md)
- [Supervised Workflow](docs/supervised-workflow.md)
- [Workflow Runtime](docs/workflow-runtime.md)
- [Known Limitations](docs/known-limitations.md)
- [Pilot Kit](docs/pilot-kit.md)
- [Operator Policy](docs/operator-policy.md)
- [Security Model](docs/security-model.md)
- [Coordinator Mode Compatibility](docs/coordinator-mode.md)
- [Adapter Contract](docs/adapter-contract.md)
- [Release Notes](docs/release-notes.md)

## Status

CEWP is beta software. The workflow compiler emits a source-bound agent request rather than calling a model, and the graph runtime accepts only validated, explicitly approved definitions and evidence. External pilot gates are still required before a future stable release is declared complete. Review the plan, evidence, and receipt before integrating changes.

## License

MIT. See [LICENSE](LICENSE).
