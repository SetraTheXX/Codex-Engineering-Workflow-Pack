# Coordinator Operator Mode

Use this reference when a CEWP-enabled repo user asks Codex to operate Coordinator Mode in natural language instead of asking for raw CLI commands.

## Product Model

```txt
User talks naturally.
Codex operates CEWP CLI.
CEWP enforces safety.
User approves decisions by default, or grants a broader explicit policy.
```

Role model:

```txt
User = product owner / final decision maker
Manager AI = planner / coordinator
Worker A/B = implementers
Reviewer AI = verifier
```

Core rule:

```txt
Manager AI plans.
User approves.
Workers execute.
Reviewer verifies.
User decides.
```

## Natural Language Triggers

Use Coordinator Operator Mode when the user says things like:

- "Run this with CEWP"
- "Start Coordinator Mode"
- "Split this work across workers"
- "Use the parallel Codex workflow"
- "Use the Manager/Worker/Reviewer flow"
- "Use CEWP Coordinator Mode"
- "Run this with two workers and a reviewer"

## Approval Gates

Approval gates are the default safety mode, not the only possible mode. Users may explicitly grant broader authority, including full-authority operation. Full authority still runs inside CEWP safety rails: task boundaries, worktrees, scope checks, reviewer checks, logs, and package/release checks.

High-impact actions such as merge, push, publish, and release require either explicit per-action confirmation or an explicit full-authority instruction that names those actions. Vague permission is not enough for publish or release.

Default gates:

```txt
Gate 1: User approves Manager plan.
Gate 2: User approves worker dispatch.
Gate 3: Reviewer PASS required.
Gate 4: User approves finalize.
Gate 5: User approves merge manually.
Gate 6: User approves publish/release manually.
```

## Approval Policy Modes

### Human-led / Default Safe Mode

Use this mode unless the user explicitly says otherwise.

- Present the Manager plan to the user.
- Ask before worker dispatch.
- Require reviewer `Decision: PASS`.
- Ask before finalize.
- Keep merge, push, publish, and release manual.

Example:

```txt
Use CEWP in safe mode and ask me at every gate.
```

### Trusted Operator Mode

Use this mode when the user explicitly grants trusted operation for non-destructive CEWP workflow steps.

Codex may run these without asking every time, while still reporting results:

- `cewp run init`
- `cewp run worktrees create`
- `cewp run dispatch check`
- `cewp run dispatch prompts`
- `cewp run dispatch pipeline`
- `cewp run collect`
- cleanup dry-runs

Finalize, cleanup with `--yes`, merge, push, publish, and release still depend on the user's stated policy.

Examples:

```txt
Use trusted mode for this repo and run non-destructive CEWP steps without asking each time.
```

```txt
Run the pipeline yourself for this task, but ask me before finalize.
```

### Full Authority / Advanced Mode

This is a real supported advanced mode for experienced users. Use it only when the user explicitly grants full authority for a repo, task, or release.

Full authority means Codex may run the CEWP workflow with fewer pauses. It does not mean "no rules." Codex must still obey:

- task boundaries,
- separate worktrees for parallel work,
- `allowedFiles` and `forbiddenFiles`,
- dispatch checks,
- worker post-checks,
- reviewer gate,
- runtime logs and reports.

If the user explicitly grants full authority, Codex may run local workflow actions such as finalize or cleanup when they are in scope. Merge, push, publish, and release still require either per-action confirmation or an explicit full-authority instruction that names those actions.

Examples:

```txt
Use CEWP full authority mode for this repo. Plan the work, run the workers, pass it through the reviewer, and finalize if appropriate. Do not merge, push, or publish unless I explicitly say so.
```

```txt
I grant full authority for this release task: run the tests, bump the version, publish, and perform the GitHub release steps. Log every step and stop if anything fails.
```

Hard distinctions:

- If full authority is not explicit, use default safe mode.
- If trusted mode is explicit, non-destructive workflow steps are allowed.
- If full authority is explicit, Codex can move faster but CEWP guardrails stay on.
- Vague permission is not enough for publish or release.

## Typical Operator Flow

1. Inspect repo status, docs, package scripts, and existing CEWP runtime.
2. Present a Manager plan with task split, allowedFiles, forbiddenFiles, risks, and verification.
3. Apply the active approval policy before worker dispatch.
4. Initialize or reuse a run.
5. Create task JSON files under `.cewp/runs/<run-id>/tasks/`.
6. Create worktrees after plan approval or under trusted/full-authority policy.
7. Run dispatch checks and prompts.
8. Dispatch workers sequentially or in parallel only after the active policy allows it.
9. Collect a review packet and run reviewer.
10. Finalize only when reviewer PASS and the active policy allows it.
11. Suggest cleanup and pruning; ask before destructive `--yes` actions unless explicit policy allows them.

Typical commands Codex may operate:

```powershell
cewp run init --workers 2 --reviewer
cewp run status
cewp run worktrees create --run <run-id>
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --yes --parallel --timeout 120
cewp run finalize --run <run-id> --dry-run
cewp run finalize --run <run-id>
cewp run cleanup --run <run-id>
cewp run prune --keep 10
```

Use dry-run commands where available before destructive or state-changing actions.

## Safety Rules

- Do not run worker dispatch before the user approves the Manager plan, unless trusted/full-authority policy explicitly allows it.
- Do not run destructive cleanup with `--yes` unless user approval or active policy explicitly allows it.
- Do not finalize unless reviewer report contains `Decision: PASS` and user approval or active policy allows finalize.
- Do not merge, push, publish, or create a release automatically unless the user explicitly grants authority for those named actions.
- Do not let workers write `board.json`.
- Do not let reviewer write `board.json`.
- Treat `.cewp/`, `.cewp-worktrees/`, and `.cewp-worker-output/` as local runtime artifacts that should not be committed.
- Prefer separate worktrees for parallel workers.
- If `dispatch check` reports FAIL, stop and explain before continuing.

## User-Facing Summary Shape

Before dispatch, summarize:

```txt
Goal:
Tasks:
- task-001 -> worker-a -> allowedFiles [...]
- task-002 -> worker-b -> allowedFiles [...]
Forbidden files:
Verification:
Risks:
Commands I will run after approval:
Approval needed:
```

After reviewer:

```txt
Reviewer decision:
Worker results:
Changed files:
Scope warnings:
Recommended next step:
Approval needed:
```

## Non-Goals

- No automatic merge.
- No automatic push.
- No automatic publish or release.
- No hidden background worker execution.
- No same-working-tree parallel edits.
