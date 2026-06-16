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

### CodeGraph-assisted code discovery

CodeGraph is not a CEWP runtime dependency. It is a local developer workflow helper for starting new Codex tasks with a repo map before broad `grep`, `rg`, or random file-reading loops.

When CodeGraph is available, use it first for repository exploration, symbol search, caller/callee checks, and impact analysis. Treat CodeGraph output as discovery context only: every code or docs change still needs the normal project test, check, or smoke commands before it is trusted.

`.codegraph/` is a local index directory and must not be committed. Keep local/private paths such as `.ctxo/`, `.cewp/`, `.cewp-worktrees/`, and `.codegraph/` out of commits.

## Roles

Manager:
- reads the user goal and repo context,
- plans the work,
- creates or updates task files,
- recommends dispatch and final decisions.

Workers:
- work inside assigned git worktrees,
- follow `allowedFiles` and `forbiddenFiles`,
- require explicit `allowedFiles` for real guarded execution,
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

Worker worktrees are managed under `../.cewp-worktrees/` by default. External, absolute, or traversal-style `targetWorktree` paths are rejected unless they resolve inside that managed root.

## Dispatch Planning

Before any agent execution, inspect the dispatch plan:

```bash
cewp run dispatch plan --run <run-id>
cewp run dispatch check --run <run-id>
cewp run dispatch prompts --run <run-id>
cewp run dispatch start --run <run-id> --dry-run
```

These commands map tasks to workers, worktrees, prompt bundles, report paths, event logs, and reviewer inputs.

## Operator Run Browser

Browse and inspect runs without changing runtime state:

```bash
cewp run list
cewp run list --limit 10
cewp run list --json
cewp run status
cewp run status <run-id>
cewp run status --run <run-id>
cewp run status <run-id> --json
cewp run next
cewp run next <run-id>
cewp run next --run <run-id>
cewp run next <run-id> --json
cewp run resume
cewp run resume <run-id>
cewp run resume --run <run-id>
cewp run resume <run-id> --json
```

Use `run list` to find recent runs, see the latest run, scan artifact presence, and choose a run id. Use `run status` for the detailed inventory and suggested actions. Use `run next` when you want CEWP to print only the single most relevant safe command and a short reason. Use `run resume` when handing a run back to an operator or another agent; it prints a compact Markdown resume packet with state, artifacts, the recommended next command, manual completion hints when relevant, and useful follow-up commands. These commands support human-readable output by default and `--json` for tools, scripts, or future operator interfaces. Operator JSON uses a beta `operator-json/v1` envelope with `schemaVersion`, `command`, `generatedAt`, `data`, and `warnings`; the command payload remains inside `data`. `run status --json` and `run resume --json` include a typed, read-only artifact inventory under `data.artifacts.inventory` and a read-only timeline projection from existing `events/*.jsonl` files, including malformed-line warnings when an event cannot be parsed. They can suggest manual result intake, review packet collection, reviewer dry-run, or finalize dry-run, but they do not run those actions automatically.

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

Parallel mode starts only `worker-a` and `worker-b`. It requires separate worktrees, different tasks, and non-overlapping `allowedFiles`. Directory scopes such as `docs/**` overlap with files under that directory, such as `docs/install.md`. Reviewer execution happens after workers finish.

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

Cleanup does not remove arbitrary external paths, even if an older or edited registry points outside the CEWP-managed worktree root.

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
