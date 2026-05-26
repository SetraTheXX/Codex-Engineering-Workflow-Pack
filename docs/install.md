# Install Guide

This document explains how to install Codex Engineering Workflow Pack v0.1 into another project or into your global local skill folder.

The installer copies only the 10 v0.1 skill folders from:

```txt
.agents/skills/
```

It does not install new dependencies and does not touch secrets or project config.

## CLI Install

The npm CLI is the v0.2 MVP install path. The `npx` command will work after the npm package is published.

Repo-scoped install into the current directory:

```bash
npx @setrathexx/codex-engineering-workflow-pack init
```

After global npm install:

```bash
npm install -g @setrathexx/codex-engineering-workflow-pack
cewp init
```

Explicit repo install:

```bash
cewp init --mode repo
cewp init --mode repo --target "/path/to/target-repo"
cewp init --mode repo --target "/path/to/target-repo" --force
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

Planned commands:

- `cewp link`
- `cewp update`
- `cewp uninstall`
- interactive mode
- symlink/shared setup

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

### Permission denied on install.sh

On Unix/macOS/Linux, make the installer executable:

```bash
chmod +x ./install.sh
```

Then run it again.

### Secrets safety

The installer does not read or copy `.env`, `config/api_keys.json`, `*.pem`, `*.key`, or target repo config files. It only copies the approved skill folders.
