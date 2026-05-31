# CEWP Harness Smoke

This harness runs a deterministic Coordinator Mode smoke test without starting Codex agents or using `codex exec`.

Run it from the repository root:

```bash
node tests/harness/run-smoke.js
```

The harness creates temporary git repositories, initializes CEWP runs, creates worker worktrees, commits fixture changes inside those worktrees, checks committed-diff scope reporting, verifies `run prune`, and removes its temporary repos at the end.

It is intended for release prep and regression checks. It does not publish, push, merge, change package version, or exercise the real codex-exec adapter.
