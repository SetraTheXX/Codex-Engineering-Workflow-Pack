# CEWP Harness Smoke

This harness runs a deterministic Coordinator Mode smoke test without starting Codex agents or using `codex exec`.

Run it from the repository root:

```bash
node tests/harness/run-smoke.js
```

Or use the package script:

```bash
npm test
```

The harness creates temporary git repositories, initializes CEWP runs, creates worker worktrees, commits fixture changes inside those worktrees, checks committed-diff scope reporting, verifies `run prune`, and removes its temporary repos at the end.

It also uses a test-only fake Codex executable path to exercise the `codex-exec` lifecycle without starting the real Codex CLI: worker execution, `.cewp-worker-output/` handoff, report copying, adapter logs, last-message output, scope post-checks, and review-packet collection before reviewer execution.

It is intended for release prep and regression checks. It does not publish, push, merge, change package version, or start the real Codex CLI.
