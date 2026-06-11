# Install Guide

This guide covers installing Codex Engineering Workflow Pack (CEWP) in a repo or global Codex skills folder.

CEWP has two surfaces:

- reusable workflow skills under `.agents/skills/`
- a local Coordinator Mode runtime under `.cewp/`

## Requirements

- Node.js 18 or newer
- Git
- Codex CLI, required only for guarded `codex-exec` dispatch

## One-Time Repo Install

Install CEWP skills into the current repo:

```bash
npx @setrathex/codex-engineering-workflow-pack init
```

Install into a specific repo:

```bash
npx @setrathex/codex-engineering-workflow-pack init --mode repo --target "/path/to/repo"
```

After install, verify:

```bash
npx @setrathex/codex-engineering-workflow-pack doctor
npx @setrathex/codex-engineering-workflow-pack list
```

## Global Install

Install the CLI globally if you use CEWP across many repos:

```bash
npm install -g @setrathex/codex-engineering-workflow-pack
cewp init
```

Install globally scoped skills:

```bash
cewp init --mode global
cewp init --mode global --force
```

Verify:

```bash
cewp doctor
cewp list
```

## Repo Install Options

```bash
cewp init --mode repo
cewp init --mode repo --with-config
cewp init --mode repo --target "/path/to/repo"
cewp init --mode repo --target "/path/to/repo" --force
```

Force mode refreshes CEWP skill files in existing skill folders. It does not delete unrelated project files.

Use `--with-config` to create a starter root-level `cewp.config.json` adapter config. If the file already exists, CEWP leaves it unchanged.

## Codex-Led Operation

Users do not need to memorize every CEWP command. In a CEWP-enabled repo, ask Codex to run Coordinator Mode:

```txt
Use CEWP Coordinator Mode to implement this change with two workers and a reviewer. Show me the plan before dispatch.
```

Codex should use the CEWP CLI as the local safety and runtime engine, show plans before dispatch, and ask for approval at the relevant gates.

## Operator Policy

CEWP can store repo-local operator policy in:

```txt
.cewp/policy.json
```

Commands:

```bash
cewp policy show
cewp policy set safe
cewp policy set trusted
cewp policy set full-authority
cewp policy reset
```

`safe` is the default. `full-authority` is a supported advanced mode for experienced users, but it does not disable CEWP guardrails. Push, publish, and release remain disabled by default unless explicitly allowed later.

See [Operator Policy](operator-policy.md).

## Coordinator Mode

Coordinator Mode creates local runtime state for multi-agent engineering workflows:

```bash
cewp run init --workers 2 --reviewer
cewp run worktrees create --run <run-id>
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --dry-run
cewp run dispatch pipeline --run <run-id> --adapter codex-exec --yes --parallel --timeout 120
cewp run finalize --run <run-id> --dry-run
cewp run finalize --run <run-id>
cewp run cleanup --run <run-id>
```

See [Coordinator Mode](coordinator-mode.md).

## Runtime Files

The following are local runtime artifacts and should not be committed:

```txt
.cewp/
.cewp-worktrees/
.cewp-worker-output/
```

`.cewp/runs/<run-id>/` contains generated board, task, prompt, report, review, event, adapter-output, and review-packet files.

`cewp run cleanup` removes registered worker worktrees and is dry-run by default. `cewp run prune` removes old run history and is also dry-run by default. `run prune` does not remove `.cewp-worktrees/`.

## Security Notes

CEWP does not automatically:

- merge,
- push,
- publish,
- create releases,
- finalize without reviewer PASS.

Worker scope checks include both uncommitted changes and committed branch changes since each worktree's registered `baseCommit`.

See [Security Model](security-model.md).

## Fallback Script Installers

The npm CLI is recommended. If npm is unavailable, the repo also includes fallback installers.

Windows PowerShell:

```powershell
.\install.ps1 -Mode repo -Target "C:\path\to\target-repo"
.\install.ps1 -Mode global
```

Unix, macOS, and Linux:

```bash
./install.sh --mode repo --target "/path/to/target-repo"
./install.sh --mode global
```

Use force mode to refresh existing CEWP skill folders:

```powershell
.\install.ps1 -Mode repo -Target "C:\path\to\target-repo" -Force
```

```bash
./install.sh --mode repo --target "/path/to/target-repo" --force
```

## Troubleshooting

Useful checks:

```bash
cewp --help
cewp doctor
cewp list
cewp run status
```

CLI errors are intentionally short. Use `cewp --help` for full usage and `cewp doctor` for install diagnostics.

For release-prep smoke testing in this repo:

```bash
node tests/harness/run-smoke.js
```

The harness uses temporary repos, exercises Coordinator Mode runtime helpers, and does not run `codex exec`, publish, push, merge, or change package version.

If Codex does not show installed skills, restart or reload Codex and confirm that each skill has:

```txt
<repo>/.agents/skills/<skill-name>/SKILL.md
```

or, for global install:

```txt
$HOME/.agents/skills/<skill-name>/SKILL.md
```
