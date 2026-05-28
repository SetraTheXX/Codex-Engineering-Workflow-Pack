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
