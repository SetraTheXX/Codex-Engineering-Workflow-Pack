# Coordinator Operator Mode

Use this reference when a CEWP-enabled repo user asks Codex to operate Coordinator Mode in natural language instead of asking for raw CLI commands.

## Product Model

```txt
User talks naturally.
Codex operates CEWP CLI.
CEWP enforces safety.
User approves decisions.
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

- "CEWP ile yurut"
- "Coordinator Mode baslat"
- "Bu isi workerlarla bol"
- "Paralel Codex workflow kullan"
- "Manager/worker/reviewer akisiyla yap"
- "Use CEWP Coordinator Mode"
- "Run this with two workers and a reviewer"

## Approval Gates

Do not collapse these gates unless the user explicitly approves that exact action.

```txt
Gate 1: User approves Manager plan.
Gate 2: User approves worker dispatch.
Gate 3: Reviewer PASS required.
Gate 4: User approves finalize.
Gate 5: User approves merge manually.
Gate 6: User approves publish/release manually.
```

## Typical Operator Flow

1. Inspect repo status, docs, package scripts, and existing CEWP runtime.
2. Present a Manager plan with task split, allowedFiles, forbiddenFiles, risks, and verification.
3. Wait for user approval before worker dispatch.
4. Initialize or reuse a run.
5. Create task JSON files under `.cewp/runs/<run-id>/tasks/`.
6. Create worktrees only after plan approval.
7. Run dispatch checks and prompts.
8. Dispatch workers sequentially or in parallel only after user approval.
9. Collect a review packet and run reviewer.
10. Ask for user approval before finalize.
11. Suggest cleanup and pruning, but ask before destructive `--yes` actions.

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

- Do not run worker dispatch before the user approves the Manager plan.
- Do not run destructive cleanup with `--yes` before user approval.
- Do not finalize unless reviewer report contains `Decision: PASS` and the user approves finalize.
- Do not merge, push, publish, or create a release automatically.
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
