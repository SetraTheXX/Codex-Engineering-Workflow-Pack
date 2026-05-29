# Install Guide

This document explains how to install Codex Engineering Workflow Pack v0.1 into another project or into your global local skill folder.

The installer copies only the 10 v0.1 skill folders from:

```txt
.agents/skills/
```

It does not install new dependencies and does not touch secrets or project config.

## CLI Install

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
cewp init --mode repo --target "/path/to/target-repo"
cewp init --mode repo --target "/path/to/target-repo" --force
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

MVP supported commands:

- `cewp init`
- `cewp init --mode repo`
- `cewp init --mode global`
- `cewp init --mode repo --target "<path>"`
- `cewp init --mode repo --target "<path>" --force`
- `cewp init --mode global --force`
- `cewp doctor`
- `cewp list`

Planned commands:

- `cewp update`
- `cewp uninstall`
- interactive mode
- symlink/shared setup

## Coordinator Mode Runtime

Coordinator Mode is separate from installing the 10 workflow skills. Skill install copies reusable Codex instructions into `.agents/skills/`; Coordinator Mode creates per-run local state for a manual multi-pane coordination session.

Start a local coordination run from a repo:

```bash
cewp run init --workers 2 --reviewer
cewp run prompts
cewp run status
```

Run commands use the latest run by default. Use `--run <id>` to inspect a specific run:

```bash
cewp run status --run 20260528-232250
cewp run prompts --run 20260528-232250
```

After a Manager creates task files, `cewp run worktrees plan` can preview suggested manual worktrees:

```bash
cewp run worktrees plan
cewp run worktrees plan --run 20260528-232250
```

This command only prints suggested `git worktree add` commands. It does not create worktrees or run Codex.

`cewp run worktrees create` is also part of Coordinator Mode runtime. It prepares git worktree directories for worker sessions, but it does not start worker agents, merge, push, or publish:

```bash
cewp run worktrees create --dry-run
cewp run worktrees create --run 20260528-232250
```

After `create`, inspect registered worktrees with:

```bash
cewp run worktrees status
```

This helper reads `worktrees.json`, reports clean/dirty state, and warns when changed files fall outside `allowedFiles` or match `forbiddenFiles`. It does not merge, push, publish, or remove worktrees.

`cewp run dispatch plan` previews task-to-agent dispatch:

```bash
cewp run dispatch plan
```

It maps tasks, registered worktrees, prompts, reports, and event logs before worker execution. It does not spawn processes, run `codex exec`, merge, push, or publish.

`cewp run dispatch check` verifies readiness before dispatch:

```bash
cewp run dispatch check
```

It reports PASS/WARN/FAIL for task, worktree, prompt, and reviewer readiness. It is a preflight for the user approval gate and does not spawn processes or mutate runtime state.

`cewp run collect` creates a reviewer packet from local run state:

```bash
cewp run collect
```

The packet is written under `.cewp/runs/<run-id>/review-packets/`. It is Coordinator Mode runtime state, not installed skill content or package content.

`cewp run finalize` closes Coordinator Mode runtime state after reviewer approval:

```bash
cewp run finalize --dry-run
```

It requires `Decision: PASS`, marks run/board/tasks completed under `.cewp/`, and does not merge source code, publish, release, or remove worktrees. Source integration and release still require explicit user approval.

`cewp run cleanup` removes registered worker worktrees after review:

```bash
cewp run cleanup
cewp run cleanup --yes
```

Cleanup is dry-run by default. With `--yes`, it removes only clean registered worktrees under `.cewp-worktrees/`, skips dirty worktrees, and keeps run history under `.cewp/runs/`. Source code merge/release still requires explicit user approval.

Runtime state is written under:

```txt
.cewp/runs/<run-id>/
```

This folder contains generated board, task, prompt, report, review, event, and handoff files for one coordination run. These files are runtime artifacts, not installed skills or package content, and should not be committed. Add `.cewp/` to the project `.gitignore` for repos that use Coordinator Mode.

Coordinator Mode remains manual orchestration. It does not spawn Codex processes, automate terminal input, merge, push, or publish.

## Repo Sharing vs Local-only

If `.agents/skills/` should be shared with the project or team, commit it to the repo.

For local-only use, do not add `.agents/skills/` to the repo `.gitignore`. Use the local exclude file instead:

```txt
.git/info/exclude
```

Add this line:

```gitignore
.agents/skills/
```

This keeps the public repo surface clean while allowing local repo-scoped skills.

## Search Tool Note

Some skills prefer ripgrep (`rg`) when available for fast repo search. It is recommended but not required. If `rg` is unavailable, Codex can use IDE search, PowerShell `Get-ChildItem`, `git grep`, or normal file search.

## Skill Set

- `setup-codex-engineering-workflow`
- `diagnose`
- `tdd`
- `grill-with-docs`
- `to-prd`
- `to-issues`
- `handoff`
- `zoom-out`
- `prototype`
- `improve-codebase-architecture`

## Repo-scoped Install

This section documents the fallback script installers. Prefer the CLI install path when npm is available.

Repo-scoped install copies skills to:

```txt
<target-repo>/.agents/skills/
```

Use this mode when the target repo should carry its own workflow instructions.

The target repo path must already exist. The installer creates `.agents/skills/` inside it if needed.

Windows PowerShell:

```powershell
.\install.ps1 -Mode repo -Target "C:\path\to\target-repo"
```

Unix/macOS/Linux:

```bash
./install.sh --mode repo --target "/path/to/target-repo"
```

## Global Install

Global install copies skills to:

```txt
$HOME/.agents/skills/
```

Use this mode when you want the pack available to many local repos.

Windows PowerShell:

```powershell
.\install.ps1 -Mode global
```

Unix/macOS/Linux:

```bash
./install.sh --mode global
```

## Manual Copy

Manual install is just a folder copy.

Repo-scoped target:

```txt
<target-repo>/.agents/skills/
```

Global target:

```txt
$HOME/.agents/skills/
```

Copy each approved v0.1 skill folder from this repo's `.agents/skills/` directory into the chosen target.

## Update / Reinstall

By default, installers skip a skill if the target skill folder already exists.

Use force mode to overwrite files inside existing skill folders:

Windows PowerShell:

```powershell
.\install.ps1 -Mode repo -Target "C:\path\to\target-repo" -Force
.\install.ps1 -Mode global -Force
```

Unix/macOS/Linux:

```bash
./install.sh --mode repo --target "/path/to/target-repo" --force
./install.sh --mode global --force
```

Force mode does not delete the target skill folder first. It copies files over the existing folder, which avoids destructive cleanup of user-local additions.

## Uninstall

There is no destructive uninstall command in v0.1.

To uninstall manually, remove only the installed skill folders you intentionally installed:

```txt
<target-repo>/.agents/skills/<skill-name>/
$HOME/.agents/skills/<skill-name>/
```

Before deleting anything, confirm the target path is the repo or global skill folder you intended. Do not remove the whole `.agents` directory if it contains project-specific files.

## Troubleshooting

### A skill already exists

The installer skips existing skill folders unless force mode is enabled.

Use force mode only when you want to refresh this pack's files:

```powershell
.\install.ps1 -Mode repo -Target "C:\path\to\target-repo" -Force
```

```bash
./install.sh --mode repo --target "/path/to/target-repo" --force
```

### Repo mode says target is required

Repo mode must know where to install:

```powershell
.\install.ps1 -Mode repo -Target "C:\path\to\target-repo"
```

```bash
./install.sh --mode repo --target "/path/to/target-repo"
```

If the target path does not exist, create or download the repo first, then rerun the installer.

### Codex does not show the skills

Restart or reload Codex after installing.

If using repo-scoped install, make sure Codex is opened in the target repo and that the skills exist under:

```txt
<target-repo>/.agents/skills/<skill-name>/SKILL.md
```

If using global install, confirm the skills exist under:

```txt
$HOME/.agents/skills/<skill-name>/SKILL.md
```

You can also run:

```bash
cewp doctor
```

### Permission denied on install.sh

On Unix/macOS/Linux, make the installer executable:

```bash
chmod +x ./install.sh
```

Then run it again.

### Secrets safety

The installer does not read or copy `.env`, `config/api_keys.json`, `*.pem`, `*.key`, or target repo config files. It only copies the approved skill folders.
