# Codex Engineering Workflow Pack

[![npm version](https://img.shields.io/npm/v/@setrathex/codex-engineering-workflow-pack?tag=latest)](https://www.npmjs.com/package/@setrathex/codex-engineering-workflow-pack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Codex Engineering Workflow Pack is a local-first skill pack for structured engineering workflows in Codex.

This is an unofficial local-first skill pack for Codex.

It provides reusable workflows for setup, diagnosis, TDD, PRD writing, issue slicing, handoff, and architecture analysis.

## What Problem It Solves

Codex is strongest when a repo gives it clear local context, small implementation slices, explicit verification commands, and durable handoff notes. This pack turns those habits into reusable repo-scoped skills.

The goal is to reduce:

- vague feature scope,
- missing test feedback loops,
- large hard-to-check changes,
- lost domain language,
- weak session handoff,
- accidental remote-first issue workflow assumptions.

## v0.1 Skills

1. `setup-codex-engineering-workflow` - establish local docs, issues, ADRs, tests, package manager, and handoff paths.
2. `diagnose` - reproduce and debug bugs, regressions, flaky behavior, and performance surprises.
3. `tdd` - implement features or fixes through red-green-refactor vertical slices.
4. `grill-with-docs` - clarify and challenge a fuzzy plan against existing docs, domain language, and ADRs.
5. `to-prd` - convert a conversation or plan into a local-first PRD.
6. `to-issues` - split a PRD or plan into implementable local markdown issues.
7. `handoff` - create concise continuation notes for a later Codex session.
8. `zoom-out` - map an unfamiliar code area before edits begin.
9. `prototype` - run approved throwaway experiments before production implementation.
10. `improve-codebase-architecture` - audit architecture friction and sequence small refactors.

## Workflow Recipes

- New feature: `setup-codex-engineering-workflow` -> `grill-with-docs` -> `to-prd` -> `to-issues` -> `tdd` -> `handoff`
- Bug or regression: `zoom-out` -> `diagnose` -> `tdd` -> `handoff`
- Architecture cleanup: `zoom-out` -> `improve-codebase-architecture` -> `to-issues` -> `tdd`
- Small safe change: use `tdd` directly; PRD/issue docs are not required.

## Quick Install

Use `npx` for a one-time repo-scoped install, or install the CLI globally if you use the pack across many projects.

Repo-scoped install into the current directory:

```bash
npx @setrathex/codex-engineering-workflow-pack init
```

After global npm install:

```bash
npm install -g @setrathex/codex-engineering-workflow-pack
cewp init
```

Explicit repo install:

```bash
cewp init --mode repo
cewp init --mode repo --target "/path/to/your/repo"
cewp init --mode repo --target "/path/to/your/repo" --force
```

Check an install:

```bash
cewp doctor
cewp list
```

Global skill install:

```bash
cewp init --mode global
cewp init --mode global --force
```

## Codex-led Usage

Users do not need to memorize every CEWP command. In a CEWP-enabled repo, ask Codex to run Coordinator Mode. Codex should use the CEWP CLI as the local safety/runtime engine, show the plan, and ask for approval at the defined gates.

Example:

```txt
Use CEWP Coordinator Mode to implement this docs-only change with two workers and a reviewer. Show me the plan before dispatch.
```

Codex operates the CLI, CEWP records auditable local runtime state, and the user keeps final control by default. Repos can also store an operator policy in `.cewp/policy.json`:

```bash
cewp policy show
cewp policy set safe
cewp policy set trusted
cewp policy set full-authority
cewp policy reset
```

`safe` is the default. Advanced users can set `trusted` or `full-authority` once per repo so Codex can read the local policy and ask fewer repeated questions. Full authority is a supported advanced mode, but it does not disable CEWP guardrails; worktrees, allowedFiles/forbiddenFiles, scope checks, reviewer decisions, logs, and reports still apply. Push, publish, and release remain disabled by default unless explicitly enabled by policy later.

Planned CLI commands:

- `cewp update`
- `cewp uninstall`
- interactive mode
- symlink/shared setup

## Coordinator Mode

Coordinator Mode is a v0.2 CLI skeleton for manual multi-pane orchestration. It helps a Manager Codex, Worker Codex sessions, and a Reviewer/Debugger Codex coordinate through local files while the user stays in control.

Start a local run:

```bash
cewp run init --workers 2 --reviewer
```

Then open Warp or another terminal with separate panes:

```txt
Pane 1: Manager Codex
Pane 2: Worker A Codex
Pane 3: Worker B Codex
Pane 4: Reviewer Codex
```

Each pane is a separate Codex session. Paste the matching generated prompt into each pane, let the Manager assign and track tasks through the run files, and have each Worker report back through its own report and event log.

Print prompt locations and paste commands:

```bash
cewp run prompts
cewp run prompt manager
cewp run prompt worker-a
cewp run prompt worker-b
cewp run prompt reviewer
```

Check the latest run:

```bash
cewp run status
```

Run commands use the latest run by default. To inspect a specific run:

```bash
cewp run status --run 20260528-232250
cewp run prompt manager --run 20260528-232250
```

Preview suggested manual worktrees for Manager-created task files:

```bash
cewp run worktrees plan
cewp run worktrees plan --run 20260528-232250
```

`worktrees plan` only reads task files and prints suggested `git worktree add` commands. It does not create worktrees, merge, push, or run Codex.

Create the planned git worktrees after reviewing the plan:

```bash
cewp run worktrees create --dry-run
cewp run worktrees create --run 20260528-232250
```

`worktrees create` only prepares git worktree directories for worker sessions. It does not start Codex, merge, push, or publish.

Inspect registered worktrees:

```bash
cewp run worktrees status
cewp run worktrees status --run 20260528-232250
```

`worktrees status` reports clean/dirty state, committed branch changes since the registered `baseCommit`, and allowed/forbidden file warnings. It is read-only and does not merge, push, publish, or remove worktrees. Older runs without `baseCommit` may show safety warnings; create fresh worktrees for full committed-diff visibility.

Preview agent dispatch without starting agents:

```bash
cewp run dispatch plan
cewp run dispatch plan --run 20260528-232250
```

`dispatch plan` maps tasks to registered worktrees, role prompts, report paths, and event logs. It is read-only, does not start Codex or `codex exec`, and gives the user an approval gate before worker execution.

Check dispatch readiness:

```bash
cewp run dispatch check
cewp run dispatch check --run 20260528-232250
```

`dispatch check` is a read-only preflight for worker/reviewer dispatch. It verifies the worktree registry has `baseCommit` data for committed-diff checks, reports PASS/WARN/FAIL, does not start agents, and does not mutate run state.

Create concrete dispatch prompt bundles:

```bash
cewp run dispatch prompts
cewp run dispatch prompts --run 20260528-232250
```

`dispatch prompts` writes task/worktree-specific prompt bundles under `.cewp/runs/<run-id>/dispatch-prompts/`. It does not start agents; the user manually pastes each prompt into the matching Codex session.

Preview dispatch execution:

```bash
cewp run dispatch start --dry-run
cewp run dispatch start --run 20260528-232250 --dry-run
```

`dispatch start` is dry-run only in this slice. It prints manual execution steps for workers and reviewer, does not start agents, and does not run `codex exec`, merge, push, or publish.

Preview a future `codex exec` adapter command:

```bash
cewp run dispatch exec worker-a --adapter codex-exec --dry-run
cewp run dispatch exec worker-a --run 20260528-232250 --adapter codex-exec --dry-run
```

`dispatch exec` currently renders a safe command preview only. It does not run `codex exec`, start agents, write adapter output, merge, push, or publish.

Run a single worker through the guarded `codex-exec` adapter:

```bash
cewp run dispatch exec worker-a --adapter codex-exec --yes
cewp run dispatch exec worker-a --adapter codex-exec --yes --timeout 120
```

`--yes` is required for real execution and is currently limited to one worker role at a time. Reviewer execution is still manual/dry-run. After `codex exec` exits, CEWP checks both working tree changes and committed branch changes from the registered `baseCommit` against `allowedFiles` and `forbiddenFiles`, verifies the worker report and adapter output, and still does not merge, push, or publish.

For sandbox compatibility, worker reports are written inside the assigned worktree under `.cewp-worker-output/`. The CLI copies `.cewp-worker-output/<role>-report.md` into `.cewp/runs/<run-id>/reports/` after execution and appends `.cewp-worker-output/<role>-events.jsonl` when present. `.cewp-worker-output/` is runtime output and should not be committed.

Reviewer execution is also supported after `cewp run collect` creates a review packet:

```bash
cewp run dispatch exec reviewer --adapter codex-exec --yes --timeout 120
```

The reviewer runs inside `.cewp/runs/<run-id>/`, must write `reviews/reviewer-report.md`, and the report must contain `Decision: PASS | REQUEST_CHANGES | BLOCK`. It still does not merge, push, or publish.

Run both workers sequentially:

```bash
cewp run dispatch exec workers --adapter codex-exec --yes --timeout 120
```

`workers` runs `worker-a` then `worker-b`. It is not parallel, does not run the reviewer, and stops before `worker-b` if `worker-a` fails.

Run both workers in guarded parallel mode:

```bash
cewp run dispatch exec workers --adapter codex-exec --yes --parallel --timeout 120
```

`--parallel` starts only `worker-a` and `worker-b` at the same time. It requires separate worktrees, different assigned tasks, and non-overlapping `allowedFiles`; the reviewer still runs later and finalize, merge, push, and publish remain separate user-approved steps.

Run the guarded sequential dispatch pipeline:

```bash
cewp run dispatch pipeline --adapter codex-exec --yes --timeout 120
```

`pipeline` runs dispatch check, refreshes dispatch prompts, executes workers sequentially, collects a review packet, and executes the reviewer. It does not finalize, clean up, merge, push, or publish; finalize remains a separate user command.

Pipeline can use the same guarded worker parallel mode:

```bash
cewp run dispatch pipeline --adapter codex-exec --yes --parallel --timeout 120
```

With `--parallel`, the pipeline runs worker-a and worker-b concurrently after the parallel preflight passes, then collects and runs the reviewer after both workers finish.

Collect reviewer context into one local packet:

```bash
cewp run collect
cewp run collect --run 20260528-232250
```

`collect` writes `.cewp/runs/<run-id>/review-packets/review-packet.md` for reviewer handoff, including working tree changes, committed branch changes, and combined scope warnings. It does not merge, push, publish, or mutate board/task JSON.

Finalize a PASSed run:

```bash
cewp run finalize --dry-run
cewp run finalize --run 20260528-232250
```

`finalize` requires `Decision: PASS` in the latest reviewer report, then marks run/board/tasks completed under `.cewp/`. It does not merge, push, publish, or clean up worktrees.

Clean up registered worktrees:

```bash
cewp run cleanup
cewp run cleanup --run 20260528-232250 --yes
```

`cleanup` is dry-run by default. With `--yes`, it removes only clean registered worktrees under `.cewp-worktrees/`; dirty worktrees are skipped. It does not delete `.cewp/runs/<run-id>/`, merge, push, or publish.

Prune local run history:

```bash
cewp run prune --keep 5
cewp run prune --keep 5 --yes
cewp run prune --older-than 7d --yes
```

`.cewp/runs/` is local runtime history and is not packaged. `run prune` is dry-run by default and only deletes selected `.cewp/runs/<run-id>/` directories when `--yes` is provided. It does not remove `.cewp-worktrees/`, merge, push, or publish.

Runtime state lives under:

```txt
.cewp/runs/<run-id>/
```

This directory is local runtime state and should not be committed. `board.json` is Manager/CLI-owned, not a multi-writer file. Workers read board/tasks and write only their own report and event files. The reviewer writes only review files and its own event log.

v0.2 non-goals:

- no Codex process spawning,
- no terminal input automation,
- no auto merge,
- no auto push,
- no same-working-tree parallel worker edits,
- no automatic worktree creation.

Parallel workers must not edit the same working tree. v0.2 only recommends worktree paths such as:

```txt
../.cewp-worktrees/<repo-name>/<run-id>/<task-id>/
```

## Install Modes

### Repo Install

Copies the 10 v0.1 skills into a target project's repo-scoped skill folder:

```txt
<target-repo>/.agents/skills/
```

Use this when a project should carry its own workflow instructions.

If `.agents/skills/` should be shared with the project or team, commit it. For local-only use, do not edit the repo `.gitignore`; add `.agents/skills/` to `.git/info/exclude` instead.

### Global Install

Copies the 10 v0.1 skills into:

```txt
$HOME/.agents/skills/
```

Use this when you want the pack available across local projects.

### Manual Install

Copy the folders under this repo's `.agents/skills/` into either:

```txt
<target-repo>/.agents/skills/
$HOME/.agents/skills/
```

Do not copy unrelated docs if you only want the skills.

## Windows PowerShell Install

The PowerShell installer is kept as a fallback for environments that do not use npm.

Repo-scoped:

```powershell
.\install.ps1 -Mode repo -Target "C:\path\to\your\repo"
```

Global:

```powershell
.\install.ps1 -Mode global
```

Overwrite existing installed skill files without deleting extra target files:

```powershell
.\install.ps1 -Mode repo -Target "C:\path\to\your\repo" -Force
```

## Unix Shell Install

The shell installer is kept as a fallback for environments that do not use npm.

Repo-scoped:

```bash
./install.sh --mode repo --target "/path/to/your/repo"
```

Global:

```bash
./install.sh --mode global
```

Overwrite existing installed skill files without deleting extra target files:

```bash
./install.sh --mode repo --target "/path/to/your/repo" --force
```

## Usage Examples

After installation, ask Codex to use the workflow by name or by intent:

```txt
Use setup-codex-engineering-workflow for this repo.
```

```txt
Use to-prd to turn this feature idea into a local PRD.
```

```txt
Use to-issues to split this PRD into vertical slice issues.
```

```txt
Use tdd to implement the first issue with a failing regression test first.
```

```txt
Use diagnose to debug this failing test.
```

Check whether the pack is installed correctly:

```txt
Run cewp doctor in this repo.
```

CLI errors are intentionally short. Use `cewp --help` for full usage, `cewp doctor` for install checks, and `cewp run status` for the latest Coordinator Mode run.

### Harness smoke

For release prep, run the deterministic Coordinator Mode harness:

```bash
node tests/harness/run-smoke.js
```

It uses temporary repos and does not run `codex exec`, publish, push, merge, or change package version.

## Search Tools

Some skills prefer ripgrep (`rg`) when available for fast repo search. It is recommended but not required. If `rg` is unavailable, Codex can use IDE search, PowerShell `Get-ChildItem`, `git grep`, or normal file search.

## Local-first Approach

The pack defaults to local markdown and repo-local context:

- PRDs under `docs/agents/prds/` or a repo convention.
- Issues under `docs/agents/issues/`.
- Handoffs under `docs/agents/handoff/`.
- Architecture reports under `docs/agents/architecture/`.
- ADRs under `docs/adr/`.
- Domain language in `CONTEXT.md` or `docs/agents/domain.md`.

GitHub publishing is optional and requires an explicit user request.

## Pilot Status

v0.1 has passed local validation and early pilot use. It is not production-ready yet. Treat this as a pilot-ready workflow pack and run it against real repos before relying on it for public or team-wide distribution.

## Security Notes

- Install scripts copy only the approved 10 v0.1 skill folders.
- Install scripts do not read or copy `.env`, `config/api_keys.json`, `*.pem`, or `*.key` files.
- Existing installed skills are skipped unless `-Force` or `--force` is provided.
- Force mode overwrites copied files but does not delete the target skill directory first.
- GitHub publish is not part of installation.

## Roadmap Summary

- v0.1: local-first engineering workflow core.
- Pilot 0: self-dogfooding on this repo.
- Pilot 1: small real repo feature/fix slice.
- Pilot 2: larger repo architecture and prototype workflow.
- v0.2: additional workflow extensions only after the local core is stable.

The public repo currently ships the v0.1 skill pack, install scripts, and install guide. Internal planning and pilot notes are intentionally not part of the public surface.
