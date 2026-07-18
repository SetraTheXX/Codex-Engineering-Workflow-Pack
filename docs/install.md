# Install Guide

This guide covers the CEWP CLI, reusable engineering skills, and the thin Codex plugin.

CEWP has three public surfaces:

- reusable workflow skills under `.agents/skills/`
- a local CLI/runtime under `.cewp/`
- a thin Codex plugin that delegates supervised work to the CLI/runtime

## Requirements

- Node.js 22 or newer on a maintained release line
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

## Codex Plugin Install

The current beta plugin is installed from a CEWP source checkout through Codex's marketplace commands. The npm package remains the supported CLI distribution.

```bash
codex plugin marketplace add /path/to/Codex-Engineering-Workflow-Pack
codex plugin add cewp@cewp-local
codex plugin list
```

Remove it without deleting CEWP run evidence:

```bash
codex plugin remove cewp@cewp-local
```

The plugin installs three skills and does not copy authentication state. It does not attach to an existing ChatGPT desktop thread or add persistent UI.

## Supervised Golden Path

Validate the no-credentials fixture from a CEWP checkout:

```bash
npm run demo:supervised
```

Then see [Supervised Workflow](supervised-workflow.md) for plan, approve, execute, verify, review, receipt, finalize, pause, and recovery commands.

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

Users do not need to memorize every CEWP command. With the plugin installed, ask Codex to plan a supervised run, execute the current checkpoint, or resume a run. Core still validates every command and gate.

```txt
Use CEWP to plan one supervised checkpoint for this bounded change. Show the scope, verification, budget, owner/backend, and stopping condition before approval.
```

For simple low-risk work, native Codex goal mode alone can be the better choice. CEWP is for work where scope, recovery, verification, independent review, and receipts justify extra operations.

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

## Coordinator Mode Compatibility

The earlier Coordinator Mode remains available for compatibility. The supervised single-checkpoint workflow is the primary product direction.

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

`.cewp/supervised-runs/<run-id>/` contains canonical supervised state, append-only events, generated progress, adapter output, verification evidence, ownership, and receipt files.

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

The supervised demo uses a deterministic fake Codex process in a temporary repository. It does not use credentials or start a real provider.

If Codex does not show installed skills, restart or reload Codex and confirm that each skill has:

```txt
<repo>/.agents/skills/<skill-name>/SKILL.md
```

or, for global install:

```txt
$HOME/.agents/skills/<skill-name>/SKILL.md
```
