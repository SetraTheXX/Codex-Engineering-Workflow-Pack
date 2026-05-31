# Coordinator Mode

Coordinator Mode is CEWP's local-first runtime for multi-agent engineering workflows in Codex.

The product principle is:

```txt
Manager AI plans.
User approves.
Workers execute.
Reviewer verifies.
User decides.
```

Runtime state lives under:

```txt
.cewp/runs/<run-id>/
```

This state is local, auditable, and excluded from the npm package.

## Roles

Manager:
- reads the user goal and repo context,
- plans the work,
- creates or updates task files,
- recommends dispatch and final decisions.

Workers:
- work inside assigned git worktrees,
- follow `allowedFiles` and `forbiddenFiles`,
- write worker output under `.cewp-worker-output/`,
- do not write shared `board.json`.

Reviewer:
- verifies worker output without blindly trusting reports,
- checks scope, forbidden files, diffs, and reports,
- writes `reviews/reviewer-report.md`,
- returns `Decision: PASS | REQUEST_CHANGES | BLOCK`.

## Runtime Layout

Typical run state:

```txt
.cewp/runs/<run-id>/
  run.json
  board.json
  tasks/
  prompts/
  dispatch-prompts/
  reports/
  reviews/
  review-packets/
  events/
  worktrees.json
  adapter-output/
```

## Worktrees

CEWP uses git worktrees to isolate worker changes:

```bash
cewp run worktrees plan --run <run-id>
cewp run worktrees create --run <run-id>
cewp run worktrees status --run <run-id>
```

`worktrees create` records a `baseCommit` for each worker. Later status and post-checks compare both uncommitted changes and committed branch changes against each task's scope.

## Dispatch Planning

Before any agent execution, inspect the dispatch plan:

```bash
cewp run dispatch plan --run <run-id>
cewp run dispatch check --run <run-id>
cewp run dispatch prompts --run <run-id>
cewp run dispatch start --run <run-id> --dry-run
```

These commands map tasks to workers, worktrees, prompt bundles, report paths, event logs, and reviewer inputs.

## Codex-Exec Adapter

Dry-run previews do not start processes:

```bash
cewp run dispatch exec worker-a --run <run-id> --adapter codex-exec --dry-run
cewp run dispatch exec workers --run <run-id> --adapter codex-exec --dry-run --parallel
```

Guarded execution requires `--yes`:

```bash
cewp run dispatch exec worker-a --run <run-id> --adapter codex-exec --yes --timeout 120
cewp run dispatch exec reviewer --run <run-id> --adapter codex-exec --yes --timeout 120
```

Worker reports are written inside the assigned worktree:

```txt
.cewp-worker-output/<role>-report.md
.cewp-worker-output/<role>-events.jsonl
```

The CLI copies reports into the run directory after execution.

## Sequential And Parallel Workers

Sequential workers:

```bash
cewp run dispatch exec workers --run <run-id> --adapter codex-exec --yes --timeout 120
```

Parallel workers:

```bash
cewp run dispatch exec workers --run <run-id> --adapter codex-exec --yes --parallel --timeout 120
```

Parallel mode starts only `worker-a` and `worker-b`. It requires separate worktrees, different tasks, and non-overlapping `allowedFiles`. Reviewer execution happens after workers finish.

## Pipeline

The pipeline runs:

```txt
1. dispatch check
2. dispatch prompts
3. dispatch exec workers
4. collect
5. dispatch exec reviewer
6. final summary
```

Dry-run:

```bash
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --dry-run
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --dry-run --parallel
```

Execution:

```bash
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --yes --timeout 120
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --yes --parallel --timeout 120
```

Pipeline does not finalize, clean up, merge, push, publish, or release.

## Review Packet

Collect reviewer context:

```bash
cewp run collect --run <run-id>
```

The packet is written to:

```txt
.cewp/runs/<run-id>/review-packets/review-packet.md
```

It includes run state, tasks, worktrees, changed files, committed branch changes, scope warnings, reports, reviewer reports, recent events, and a reviewer checklist.

## Finalize

Finalize requires reviewer PASS:

```bash
cewp run finalize --run <run-id> --dry-run
cewp run finalize --run <run-id>
```

Finalize updates local runtime state only. It marks the run, board, roles, and tasks completed. It does not merge, push, publish, release, or clean up worktrees.

## Cleanup And Prune

Cleanup registered worktrees:

```bash
cewp run cleanup --run <run-id>
cewp run cleanup --run <run-id> --yes
```

Cleanup is dry-run by default. With `--yes`, it removes only clean registered worktrees under `.cewp-worktrees/`.

Prune old run history:

```bash
cewp run prune --keep 5
cewp run prune --keep 5 --yes
cewp run prune --older-than 7d --yes
```

Prune deletes selected `.cewp/runs/<run-id>/` directories only when `--yes` is provided. It does not remove `.cewp-worktrees/`.

## Not Automated

Coordinator Mode intentionally does not automatically:
- merge,
- push,
- publish,
- create releases,
- finalize without reviewer PASS,
- clean up dirty worktrees,
- disable task scope guardrails.
