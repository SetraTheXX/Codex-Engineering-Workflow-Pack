# Operator Policy

CEWP can store a repo-local operator policy at:

```txt
.cewp/policy.json
```

Codex can read this file to understand how much autonomy the user allows in the current repo. The CEWP CLI also enforces this policy for high-impact local runtime actions.

## Commands

```bash
cewp policy show
cewp policy set safe
cewp policy set trusted
cewp policy set full-authority
cewp policy reset
```

`policy reset` writes the safe default policy.

## Policy Shape

Example:

```json
{
  "schemaVersion": 1,
  "mode": "full-authority",
  "updatedAt": "2026-05-31T00:00:00.000Z",
  "authority": {
    "editFiles": true,
    "runCommands": true,
    "runCewpPipeline": true,
    "runWorkers": true,
    "runReviewer": true,
    "finalize": true,
    "cleanup": true,
    "commit": true,
    "push": false,
    "publish": false,
    "release": false
  },
  "notes": [
    "Full authority is a supported advanced mode for experienced users.",
    "Full authority does not disable CEWP guardrails.",
    "Push, publish, and release remain disabled unless explicitly enabled by policy later."
  ]
}
```

## Safe Mode

`safe` is the default.

Expected behavior:
- ask before worker dispatch,
- ask before finalize,
- ask before cleanup with `--yes`,
- no commit, push, publish, or release by default.

## Trusted Mode

`trusted` is for repos where the user allows Codex to run non-destructive CEWP steps with fewer repeated approvals.

Typical allowed behavior:
- inspect state,
- run checks,
- generate prompt bundles,
- run dry-runs,
- collect local context.

High-impact actions still need explicit approval unless a future policy explicitly allows them.

## Full Authority Mode

`full-authority` is a real supported advanced mode for experienced users.

It can allow Codex to:
- edit files,
- run local commands,
- run CEWP workers and reviewer,
- run the guarded pipeline,
- finalize local runtime state,
- clean up local runtime artifacts,
- commit local changes.

It does not disable CEWP guardrails:
- worktree isolation remains active,
- `allowedFiles` and `forbiddenFiles` remain active,
- committed and uncommitted scope checks remain active,
- reviewer decision rules remain active,
- logs and reports remain part of the workflow.

Push, publish, and release remain `false` by default. They require explicit policy permission in a future policy shape or direct user approval.

## Runtime Enforcement

Read-only and dry-run commands are allowed in every mode.

Actual high-impact local CEWP actions are checked against `.cewp/policy.json`:

- worker execution requires `authority.runWorkers`
- reviewer execution requires `authority.runReviewer`
- pipeline execution requires `authority.runCewpPipeline`, `authority.runWorkers`, and `authority.runReviewer`
- finalize requires `authority.finalize`
- cleanup and prune deletion require `authority.cleanup`

If no policy file exists, CEWP uses the safe default and blocks these actual actions. `full-authority` allows guarded local workflow actions while keeping CEWP guardrails active.

## Package And Git Behavior

`.cewp/policy.json` is local runtime/config state. It should usually be ignored by git and is not included in the npm package.
