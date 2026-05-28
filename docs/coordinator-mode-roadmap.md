# Next Codex Chat Brief

Project name: Codex Engineering Workflow Pack, abbreviated as CEWP.

Repo purpose: CEWP is an unofficial local-first skill pack for structured engineering workflows in Codex. It gives Codex reusable workflow skills for setup, diagnosis, TDD, PRD writing, issue slicing, handoff, prototyping, and architecture analysis.

Current public state: the repo is public-facing as a small npm-distributed skill pack. The public surface is intentionally narrow: `.agents/skills/`, `README.md`, `docs/install.md`, `bin/cewp.js`, fallback installers, package metadata, and license. Internal planning, pilot notes, local cache, and old private docs are not part of the public surface.

Current npm package name: `@setrathex/codex-engineering-workflow-pack`.

Current CLI name: `cewp`.

Current 10 skills:

1. `setup-codex-engineering-workflow`
2. `diagnose`
3. `tdd`
4. `grill-with-docs`
5. `to-prd`
6. `to-issues`
7. `handoff`
8. `zoom-out`
9. `prototype`
10. `improve-codebase-architecture`

Current CLI commands:

```bash
cewp init
cewp init --mode repo
cewp init --mode repo --target "<path>"
cewp init --mode repo --target "<path>" --force
cewp init --mode global
cewp init --mode global --force
cewp doctor
cewp list
cewp --help
```

Recent important improvements:

- npm CLI installer added for repo/global skill installation.
- `cewp doctor` added to validate installed skill folders.
- `cewp list` added to show installed/missing skills.
- CLI binary mapping fixed for `npx` usage.
- `--target` validation fixed so missing target values fail clearly.
- README polished with workflow recipes, install commands, and `rg`/ripgrep fallback notes.
- Package metadata polished with GitHub repository, homepage, bugs, license, keywords, and minimal `files`.

Coordinator Mode idea: turn CEWP from a single-Codex workflow discipline pack into a local-first coordination layer for multiple Codex CLI sessions. The first version should coordinate 3-5 Codex sessions through local task board files, role prompts, report files, and a reviewer gate. It should work well in Warp or similar multi-pane terminal environments.

Work to start on a new branch: design and then implement CEWP Coordinator Mode v0.2 as a new CLI/documentation layer without touching existing skill contents.

First goal for the next chat: read this roadmap, tighten the v0.2 design, produce an implementation plan, and only then proceed to the MVP CLI skeleton after approval. Do not publish npm and do not edit existing skills.

## 1. Current Product State

CEWP currently ships as a local-first Codex skill pack.

The main product is the 10-skill workflow set under:

```txt
.agents/skills/
```

The pack is installed through an npm CLI and fallback shell scripts. The installer copies only the approved skill folders and does not read secrets or project config.

Install modes:

- Repo install: copies skills into `<target-repo>/.agents/skills/`.
- Global install: copies skills into `$HOME/.agents/skills/`.
- Manual install: copy the 10 skill folders directly.

The CLI supports:

- `cewp init` for repo/global install.
- `cewp doctor` for install validation.
- `cewp list` for installed/missing skill inventory.

The product approach is local-first:

- Local markdown PRDs/issues/handoffs are preferred.
- GitHub publishing is optional and requires an explicit user request.
- Repo-scoped skills may be committed when the team wants shared workflow behavior.
- Local-only installs should use `.git/info/exclude` instead of project `.gitignore`.

Public repo surface:

- `.agents/skills/`
- `README.md`
- `docs/install.md`
- `bin/cewp.js`
- `install.ps1`
- `install.sh`
- `package.json`
- `.gitignore`
- `LICENSE`

Package state visible from local files:

- `package.json` name: `@setrathex/codex-engineering-workflow-pack`
- `package.json` version: `0.1.0-beta.5`
- CLI binary: `cewp`
- Secondary binary alias: `codex-engineering-workflow-pack`
- npm package files are limited to public product files.

Publish status note: local files show `0.1.0-beta.5`, but npm dist-tags and GitHub release alignment should be verified before any future publish or release work.

## 2. Coordinator Mode Vision

CEWP Coordinator Mode will provide a local-first coordination layer for running multiple Codex CLI sessions against the same project.

The target user flow is a Warp or similar terminal layout with 3-5 panes:

- one Manager Codex session,
- one or more Worker Codex sessions,
- one Reviewer/Debugger Codex session.

These sessions should not directly control each other. They coordinate through local files:

- task board,
- task JSON files,
- role prompts,
- per-agent event logs,
- worker reports,
- reviewer reports,
- handoff notes.

The first version must not be full automation. It should produce structure, prompts, and status visibility so the user can manually run each Codex pane with clear boundaries.

## 3. Why This Belongs Inside CEWP

Coordinator Mode belongs inside CEWP because it extends the existing product naturally.

CEWP already provides single-agent engineering discipline:

- `to-prd` turns ideas into durable product requirements.
- `to-issues` breaks work into vertical slices.
- `tdd` guides implementation through red-green-refactor.
- `diagnose` provides a systematic debugging loop.
- `zoom-out` maps unknown code areas.
- `improve-codebase-architecture` audits architecture friction.
- `handoff` preserves continuation context.

Coordinator Mode adds a multi-agent coordination layer on top of those workflows. It does not replace the skills. It makes them easier to use when several Codex sessions are working in parallel.

This should be a CEWP v0.2 module, not a separate product, because the value is the combination of workflow skills plus local orchestration discipline.

## 4. Non-Goals For v0.2

v0.2 must stay small and safe.

Non-goals:

- No Codex process spawning.
- No terminal input automation.
- No auto merge.
- No auto push.
- No parallel edits in the same working tree.
- No remote service.
- No production code editing by the Manager role.
- No workers writing shared `board.json`.
- No `AGENTS.md` or `CLAUDE.md` assumption.
- No full autonomous endless loop.
- No npm publish until the feature is tested.
- No existing skill content changes.

## 5. Core Architecture

Runtime state lives under:

```txt
.cewp/runs/<run-id>/
```

Recommended structure:

```txt
.cewp/
  runs/
    <run-id>/
      run.json
      board.json
      plan.md
      events/
        manager.jsonl
        worker-a.jsonl
        worker-b.jsonl
        reviewer.jsonl
      agents/
        manager.md
        worker-a.md
        worker-b.md
        reviewer.md
      tasks/
        task-001.json
        task-002.json
      prompts/
        manager-prompt.md
        worker-a-prompt.md
        worker-b-prompt.md
        reviewer-prompt.md
      reports/
        worker-a-report.md
        worker-b-report.md
      reviews/
        reviewer-report.md
      handoff/
        run-handoff.md
```

Important architecture rules:

- `board.json` is not multi-writer.
- Manager/CLI writes `board.json`.
- Workers read `board.json` and `tasks/*.json`.
- Each worker writes only its own report file and event file.
- Reviewer reads board, tasks, reports, diffs, and test output.
- Reviewer writes only review files and its own event file.
- CLI status reads board + reports + reviews + events and renders a summary.

This avoids JSON overwrite races and keeps agent responsibilities auditable.

## 6. Roles

### Manager

The Manager coordinates work but does not implement production code.

Responsibilities:

- read repo context and user goal,
- create a plan,
- split work into tasks,
- create task JSON files,
- generate worker prompts,
- manage board status,
- assign verification work to the reviewer,
- summarize worker/reviewer output,
- recommend merge/publish decisions for the user.

Hard limits:

- does not edit production code,
- does not merge,
- does not push,
- does not publish.

### Worker

Workers implement assigned tasks inside isolated boundaries.

Responsibilities:

- work only on the assigned task,
- stay within `allowedFiles`,
- avoid all `forbiddenFiles`,
- use TDD or the provided implementation plan,
- run verification commands when possible,
- write a report file,
- report blockers clearly.

Hard limits:

- does not merge,
- does not push,
- does not edit unrelated files,
- does not write shared `board.json`.

### Reviewer / Debugger

The Reviewer validates worker output.

Responsibilities:

- do not blindly trust worker reports,
- inspect changed files and diffs,
- check forbidden file touches,
- check scope creep,
- review test output,
- rerun or recommend verification where needed,
- return `PASS`, `REQUEST_CHANGES`, or `BLOCK`,
- suggest `diagnose` when debugging is needed.

Hard limits:

- does not implement production features,
- does not merge,
- does not push,
- does not publish.

## 7. Task Schema

Example task file:

```json
{
  "id": "task-001",
  "title": "Short task title",
  "status": "todo",
  "assignedRole": "worker-a",
  "dependsOn": [],
  "targetWorktree": "../.cewp-worktrees/<repo-name>/<run-id>/task-001",
  "branch": "cewp/task-001",
  "mission": "Precise implementation mission.",
  "allowedFiles": [],
  "forbiddenFiles": [
    ".env",
    "config/api_keys.json"
  ],
  "verification": [],
  "outputContract": {
    "summary": true,
    "changedFiles": true,
    "commandsRun": true,
    "tests": true,
    "risks": true,
    "handoff": true
  }
}
```

Allowed status values:

- `todo`
- `claimed`
- `in_progress`
- `blocked`
- `ready_for_review`
- `review_failed`
- `approved`
- `merged`
- `done`

Status ownership should be explicit in the final design. For v0.2, prefer Manager/CLI-controlled status transitions instead of arbitrary worker writes to `board.json`.

## 8. Worktree Strategy

Parallel workers must not work in the same working tree.

v0.2 should document worktree guidance and generate worktree target paths, but automatic worktree creation can wait until v0.3.

Default worktree recommendation:

```txt
../.cewp-worktrees/<repo-name>/<run-id>/<task-id>/
```

Why this location:

- repo runtime state stays inside `.cewp/`,
- worker working directories stay outside the main repo,
- diffs, reviews, and merges stay cleaner,
- ignored runtime files do not become nested worktree clutter,
- Windows paths with spaces remain manageable when quoted.

v0.2 may print suggested commands, but should not create worktrees unless that scope is explicitly approved later.

## 9. CLI Design For v0.2

MVP commands:

```bash
cewp run init --workers 2 --reviewer
cewp run status
cewp run prompts
cewp run prompt manager
cewp run prompt worker-a
cewp run prompt worker-b
cewp run prompt reviewer
```

Command behavior:

- `cewp run init --workers 2 --reviewer`
  - creates a new `.cewp/runs/<run-id>/` folder,
  - writes initial `run.json`, `board.json`, `plan.md`,
  - creates role files, prompt files, task/report/review folders,
  - prints the run id and next commands.

- `cewp run status`
  - finds the current/latest run,
  - reads board, task files, reports, reviews, and events,
  - prints task status, role status, missing reports, and review state.

- `cewp run prompts`
  - prints all role prompt paths and recommended Warp pane mapping,
  - may optionally print prompt text or concise paste instructions.

- `cewp run prompt manager`
  - prints only the manager prompt.

- `cewp run prompt worker-a`
  - prints only the worker A prompt.

- `cewp run prompt worker-b`
  - prints only the worker B prompt.

- `cewp run prompt reviewer`
  - prints only the reviewer prompt.

Avoid `cewp run start` in v0.2 because "start" implies process spawning. v0.2 is manual multi-pane coordination, not autonomous execution.

## 10. Warp Multi-Pane Manual Flow

User flow:

1. In the repo:

```bash
cewp run init --workers 2 --reviewer
```

2. Open four Warp panes:

```txt
Pane 1: Manager Codex
Pane 2: Worker A Codex
Pane 3: Worker B Codex
Pane 4: Reviewer Codex
```

3. Generate prompts:

```bash
cewp run prompts
```

4. Paste each role prompt into the matching Codex session.

5. Agents communicate by reading and writing files under:

```txt
.cewp/runs/<run-id>/
```

6. Workers produce reports. Reviewer validates them. Manager summarizes next actions.

7. The user manually decides whether to merge, publish, or continue.

## 11. v0.2 MVP Scope

v0.2 should include:

- `.cewp/runs` local runtime standard,
- `cewp run init`,
- role prompt generation,
- `cewp run status`,
- board/task/report/review schemas,
- README Coordinator Mode section,
- `docs/install.md` note for `.cewp/`,
- `.cewp/` gitignore rule,
- no npm publish until local tests and manual pilot pass.

v0.2 should not change the existing 10 skills.

## 12. v0.3 / v0.4 / v0.5 Roadmap

### v0.3

- worktree helper commands,
- `cewp run worktrees plan`,
- `cewp run worktrees create`,
- `cewp run collect`,
- better conflict preflight,
- optional run selection by id.

### v0.4

- optional adapter design,
- `codex exec` adapter research,
- `claude -p` adapter research,
- structured output capture,
- still no auto merge.

### v0.5

- reviewer gate,
- controlled merge assistant,
- conflict detection,
- forbidden file detector,
- test verification summarizer,
- stronger PASS/BLOCK reporting.

### v1.0

- semi-auto project manager,
- auto plan + auto task + auto review,
- manual merge/publish gate,
- durable audit trail for long-running multi-agent workflows.

## 13. Risks

Known risks:

- token cost can rise quickly with 3-5 active agents,
- stale state if agents read old files,
- JSON overwrite if shared files become multi-writer,
- same-file conflicts across parallel workers,
- weak reviewer accepting bad changes,
- manager creating a wrong plan and spreading it to workers,
- Windows path quoting issues,
- worktree path confusion,
- agent scope creep,
- hidden secret/config file touches,
- false PASS reports,
- test environment drift between worktrees,
- dev server port collisions,
- reports becoming too verbose to be useful.

## 14. Open Questions

Open product/design questions:

- Should the command namespace be `cewp run` or `cewp coord`?
- Should v0.2 include worktree commands or only worktree guidance?
- Should `.cewp/` be completely ignored by git?
- Should run history be retained by default?
- Should prompts be written as files only, printed to stdout, or both?
- How should Manager board-write authority be constrained?
- Is a task lock mechanism needed in v0.2?
- Should `cewp run status` pick the latest run automatically or require `--run <id>`?
- Should worker report templates be strict markdown or JSON plus markdown?
- Should reviewer decisions be written as one file per task or one consolidated report?

## 15. First Task For Next Codex Chat

Use this prompt in the next clean Codex chat:

```txt
We are continuing Codex Engineering Workflow Pack.

Repo:
<path-to-Codex-Engineering-Workflow-Pack>

Task:
Start CEWP Coordinator Mode v0.2 planning.

Rules:
- Create a new branch named feat/coordinator-mode.
- First read docs/coordinator-mode-roadmap.md.
- Do not edit existing skill contents.
- Do not touch .agents/skills except to inspect if needed.
- Do not publish npm.
- Do not bump version yet.
- Do not create a GitHub release.
- Do not bring back internal/private docs.
- Do not implement process spawning.
- Do not auto-merge or auto-push.

Goal:
Produce an implementation plan for v0.2 MVP:
- .cewp/runs runtime structure
- cewp run init
- cewp run status
- cewp run prompts
- cewp run prompt <role>
- schema files and prompt templates
- README/docs updates
- .cewp gitignore rule
- local verification commands

After the plan, stop and ask for approval before CLI implementation.
```

