# Codex Engineering Workflow Pack

[![npm version](https://img.shields.io/npm/v/@setrathex/codex-engineering-workflow-pack?tag=latest)](https://www.npmjs.com/package/@setrathex/codex-engineering-workflow-pack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Local-first engineering workflow toolkit for Codex: skills, PRDs, issues, TDD, diagnostics, handoffs, and multi-agent Coordinator Mode.

CEWP is an unofficial local-first pack for structured engineering work in Codex. It installs reusable repo or global skills, and it provides a local runtime for coordinating Manager, Worker, and Reviewer Codex sessions through files under `.cewp/`. Coordinator Mode supports worktree isolation, guarded `codex-exec` dispatch, sequential or parallel workers, review packets, reviewer decisions, and operator policy modes.

## Highlights

- 10 engineering workflow skills for setup, diagnosis, TDD, PRDs, issue slicing, handoff, prototyping, architecture review, and context mapping.
- Repo-scoped or global installation.
- Local Coordinator Mode runtime under `.cewp/runs/<run-id>/`.
- Worktree helpers for isolated worker branches.
- Dispatch planning, readiness checks, prompt bundles, and dry-run previews.
- Guarded `codex-exec` execution for workers and reviewers.
- Sequential and parallel worker execution with scope checks.
- Reviewer gate with `Decision: PASS | REQUEST_CHANGES | BLOCK`.
- Operator policy modes: `safe`, `trusted`, and `full-authority`.
- Deterministic harness smoke tests for release prep.

## Quick Start

Run once in a repo:

```bash
npx @setrathex/codex-engineering-workflow-pack init
```

Or install globally:

```bash
npm install -g @setrathex/codex-engineering-workflow-pack
cewp init
```

Check the install:

```bash
cewp doctor
cewp list
```

Start a local Coordinator Mode run:

```bash
cewp run init --workers 2 --reviewer
cewp run worktrees create --dry-run
cewp run dispatch pipeline --adapter codex-exec --dry-run
```

Ask Codex naturally:

```txt
Use CEWP Coordinator Mode to implement this docs-only change with two workers and a reviewer. Show me the plan before dispatch.
```

## Coordinator Mode

Coordinator Mode is CEWP's local runtime for multi-agent engineering work. A Manager plans and splits tasks, Workers implement in isolated worktrees, a Reviewer verifies the result, and the user decides whether to finalize, merge, push, publish, or release.

Typical flow:

```bash
cewp run init --workers 2 --reviewer
cewp run worktrees create --run <run-id>
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --dry-run
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --yes --parallel --timeout 120
cewp run finalize --run <run-id> --dry-run
cewp run finalize --run <run-id>
cewp run cleanup --run <run-id>
```

See [Coordinator Mode](docs/coordinator-mode.md).

## Operator Policy

CEWP can store a local operator policy in `.cewp/policy.json` so Codex can understand how much autonomy the user allows in a repo.

```bash
cewp policy show
cewp policy set safe
cewp policy set trusted
cewp policy set full-authority
cewp policy reset
```

`safe` is the default. `full-authority` is a supported advanced mode for experienced users, but it does not disable CEWP guardrails. Push, publish, and release remain disabled by default unless explicitly allowed by policy later.

The CLI enforces policy for actual high-impact local actions such as worker execution, reviewer execution, pipeline execution, finalize, cleanup, and prune deletion. Dry-run and read-only commands remain available in every mode.

See [Operator Policy](docs/operator-policy.md).

## Safety Model

CEWP is local-first and approval-gated. It does not automatically merge, push, publish, or create releases. Worker scope checks include both working tree changes and committed branch changes since the registered `baseCommit`. Cleanup and prune are dry-run by default.

See [Security Model](docs/security-model.md).

## Documentation

- [Install Guide](docs/install.md)
- [Coordinator Mode](docs/coordinator-mode.md)
- [Operator Policy](docs/operator-policy.md)
- [Security Model](docs/security-model.md)
- [Release Notes](docs/release-notes.md)

## Harness Smoke

For release prep:

```bash
node tests/harness/run-smoke.js
```

The harness uses temporary repos, checks Coordinator Mode helpers, and does not run `codex exec`, publish, push, merge, or change package version.

## Status

`0.2.0-beta.1` is beta software. Use it for local-first workflow automation and dogfooding, and keep reviewing generated plans, worker output, and reviewer decisions before integrating changes.

## License

MIT. See [LICENSE](LICENSE).
