# Handoff: Pilot 0 Self-dogfooding

## Current Goal

Codex Engineering Workflow Pack v0.1 is being tested on its own repository through Pilot 0 self-dogfooding.

## What Changed

Created repo-local setup files:

- `docs/agents/issue-tracker.md`
- `docs/agents/domain.md`
- `docs/agents/test-commands.md`
- `docs/agents/handoff.md`
- `CONTEXT.md`

Created local workflow directories:

- `docs/agents/issues/`
- `docs/agents/handoff/`
- `docs/agents/architecture/`
- `docs/adr/`

No new skills, scripts, assets, or `agents/openai.yaml` files were created.

## Decisions Made

- Local markdown is the default issue tracker.
- GitHub remote exists, but publishing is optional and not part of default v0.1 workflow.
- Handoff directory is singular: `docs/agents/handoff/`.
- Domain language lives in `CONTEXT.md`.
- ADRs live in `docs/adr/`.
- Validation is manual for now because no package manager or automated test suite exists.

## Verification

Repository structure was inspected with:

```powershell
rg --files --hidden
```

Existing reports were preserved:

- `docs/agents/v0.1-final-validation.md`
- `docs/agents/v0.1-pilot-test-plan.md`

## Open Questions

- Should a future validation script be added in v0.2, or should v0.1 stay manual-only through all pilots?
- Which real repo should be used for Pilot 1?

## Risks

- Without automated validation scripts, skill quality checks remain manual.
- Pilot 1 may expose missing test-command assumptions in `diagnose` and `tdd`.
- `to-issues` should be watched after Agent Brief removal to ensure implementation notes remain useful.

## Continue From Here

1. Run Pilot 0 verification against the created setup files.
2. Use `zoom-out` again if a fresh map of `.agents/skills/` is needed.
3. Select a small or medium real repo for Pilot 1.
4. Run `to-prd`, `to-issues`, `tdd`, and `diagnose` in that repo.

## Useful Paths

- `.agents/skills/`
- `docs/agents/v0.1-final-validation.md`
- `docs/agents/v0.1-pilot-test-plan.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/domain.md`
- `docs/agents/test-commands.md`
- `docs/agents/handoff.md`
- `CONTEXT.md`
