# Security Model

CEWP is local-first and approval-gated. It is designed to make multi-agent engineering workflows auditable without silently integrating changes.

## Local-First Runtime

Coordinator Mode writes runtime state under:

```txt
.cewp/runs/<run-id>/
```

Worker output inside worktrees uses:

```txt
.cewp-worker-output/
```

These are runtime artifacts. They should not be committed and are not included in the npm package.

## Worktree Isolation

Workers should operate in separate git worktrees. This keeps parallel worker changes isolated from the main working tree and from each other.

Parallel worker mode requires:
- separate worktree paths,
- different task assignments,
- non-overlapping `allowedFiles`.

## Scope Guardrails

Each task can define:

```json
{
  "allowedFiles": ["README.md"],
  "forbiddenFiles": [".env", "package.json"]
}
```

CEWP checks both:
- working tree, staged, and untracked changes from `git status --short`,
- committed branch changes from `git diff --name-only <baseCommit>...HEAD`.

This prevents a worker from bypassing scope checks by committing out-of-scope files.

`.cewp-worker-output/**` is treated as runtime output and is not a scope violation by itself.

## Reviewer Gate

Finalize requires the latest reviewer report to contain:

```txt
Decision: PASS
```

`REQUEST_CHANGES` and `BLOCK` prevent finalize.

## Dry-Run Defaults

Cleanup and prune are dry-run by default:

```bash
cewp run cleanup --run <run-id>
cewp run prune --keep 5
```

Destructive local cleanup requires `--yes`:

```bash
cewp run cleanup --run <run-id> --yes
cewp run prune --keep 5 --yes
```

Cleanup removes only clean registered worktrees. Dirty worktrees are skipped.

## No Automatic Remote Actions

CEWP does not automatically:
- merge,
- push,
- publish,
- create GitHub releases,
- create npm releases.

These actions require explicit user approval outside the default Coordinator Mode pipeline.

## Operator Policy

Operator policy can reduce repeated prompts, but it does not disable CEWP guardrails.

Even in `full-authority` mode:
- worktrees remain isolated,
- scope checks remain active,
- reviewer decision gates remain active,
- push, publish, and release remain disabled by default.

## Package Surface

The npm package includes public product files only:
- `.agents/skills/`,
- `bin/`,
- `src/`,
- selected `docs/`,
- installers,
- package metadata,
- license.

Local runtime and private planning files are excluded.
