# Release Notes

## Unreleased

- Added beta `provider-profile/v1` read models with separate binary and auth/model readiness, generated for registered adapters and summarized by `cewp doctor`.
- Added a provider profiles and terminal orchestration UI architecture plan for future operator surfaces without implementing a desktop UI, terminal server, or additional providers.
- Improved experimental OpenCode diagnostics for silent nonzero exits and clarified doctor/dogfood guidance around binary checks versus provider auth/model/config readiness.
- Hardened experimental OpenCode execution failure reporting and fake-harness coverage for unexpected JSON shapes, raw last-message fallback, stderr capture, and safe dogfood guidance.
- Added an experimental OpenCode execution MVP through guarded dispatch, with JSON output parsing, stdout/stderr capture, last-message synthesis, and fail-closed handling for malformed JSON, nonzero exits, missing binaries, and timeouts.
- Added shared executing-adapter CLI probe metadata so doctor can report binary/version/probe details for `codex-exec` and experimental `opencode`.
- Defined the experimental OpenCode command contract around `opencode run --dir <worktree> --format json <prompt>`.
- Added an experimental OpenCode adapter foundation with registry, config, doctor, dry-run, and availability visibility.
- Added a test-only external adapter contract harness for future provider readiness without adding real external provider support.

## 0.6.0-beta.0

### Summary

Adapter contract hardening and runtime observability for Phase 6. This release adds structured metadata and read-only operator projections for the existing `codex-exec` and `manual` providers; external provider implementations are not included.

### Changed

- Added typed, read-only run artifact inventory to operator status/resume JSON output.
- Added beta `operator-json/v1` envelopes for operator JSON commands while preserving payloads under `data`.
- Added read-only run timeline projection to operator status/resume JSON output.
- Added structured adapter availability metadata with doctor requirement/remediation summaries.
- Added beta `adapter-result/v1` normalized adapter result fields while preserving existing dispatch behavior.
- Added static adapter capability metadata for `codex-exec` and `manual`, with compact `cewp doctor` summaries.

## 0.5.0-beta.0

### Summary

Operator UX foundation for browsing, inspecting, resuming, and safely continuing Coordinator Mode runs. This release keeps providers limited to `codex-exec` and the non-executing `manual` adapter; external provider implementations are not included.

### Changed

- Added `cewp run resume [run-id]` to print a read-only Markdown/JSON operator resume packet for continuing a run.
- Added `--json` output for `cewp run list`, `cewp run status`, `cewp run next`, and `cewp run resume`.
- Added `cewp run list` as a read-only operator run browser for recent run state and artifact summaries.
- Added `cewp run next [run-id]` to print the single most relevant safe next command for a run.
- Added an operator-facing `cewp run status [run-id]` summary with artifact inventory and safe next-step hints.

## 0.4.0-beta.0

### Summary

Manual adapter foundation for Phase 4 adapter experiments. This release adds a non-executing `manual` provider for human-run workflows while keeping external AI providers unimplemented.

### Changed

- Added a non-executing `manual` adapter that writes role handoff prompts and fails closed until manual action is completed.
- Improved `manual` adapter dispatch output so handoff paths and non-execution status are visible in dry-run and actual summaries.
- Added `cewp run dispatch complete <role> --from <file>` to record completed manual results into the expected run artifacts.
- Expanded generated `manual` handoff files with run context, result-save guidance, and exact completion commands.

## 0.3.1-beta.0

### Summary

Adapter config hardening for the v0.3 beta line. These changes keep `codex-exec` as the only supported provider while adding optional local adapter config ergonomics and package-surface hygiene.

### Changed

- Added `cewp init --with-config` to write a starter optional adapter config template.
- Hardened adapter config smoke coverage across dispatch exec workers and dispatch pipeline paths.
- `cewp doctor` now reports the adapter config source and resolved provider summary.
- Added optional root-level `cewp.config.json` adapter config support while keeping `codex-exec` as the only supported provider.
- Clarified `.cewp-worktrees/` as ignored local worktree cache state.
- Added Coordinator Mode documentation for CodeGraph-assisted code discovery as an optional local developer workflow helper.
- Ignored `.codegraph/` as a local CodeGraph index directory that must not be committed.
- Hardened the package surface harness to assert `.codegraph/` is not included in npm package dry-runs.

## 0.3.0-beta.0

### Summary

Adapter foundation hardening for the next beta. These changes keep `codex-exec` as the only supported provider while clarifying and testing the adapter boundary.

### Changed

- Formalized the fake adapter harness setup used by worker, reviewer, and pipeline lifecycle smoke tests.
- Added a minimal internal adapter registry with `codex-exec` as the only supported provider.
- Standardized the internal adapter result shape for worker and reviewer execution summaries.
- Added role-based adapter config normalization foundation with default `codex-exec` providers.
- Routed dispatch adapter resolution through the role-aware config helper without changing CLI behavior.
- Centralized `codex-exec` command construction and preserved fake harness command overrides.
- Added `codex-exec` availability checks and informational doctor output.

### Post-Release Package Smoke

After publishing to npm, verify the released package from a clean temporary directory as a new user:

```bash
mkdir /tmp/cewp-smoke && cd /tmp/cewp-smoke
npm install @setrathex/codex-engineering-workflow-pack@latest
npx cewp --help
npx cewp init
npx cewp doctor
npx cewp list
```

This confirms the published package installs cleanly, the CLI entry point resolves, and the basic commands run without errors. It does not publish, push, tag, or create releases.

## 0.2.0-beta.2

### Summary

Validation and documentation hardening release for the Coordinator Mode dispatch lifecycle after beta.1.

### Changed

- Added deterministic fake Codex lifecycle smoke coverage for worker and reviewer execution without calling real `codex exec`.
- Added failure-path smoke coverage for worker scope violations, adapter non-zero exits, missing reviewer decisions, and reviewer `REQUEST_CHANGES`.
- Improved dispatch pipeline failure summaries with stable step statuses and short failure reasons.
- Hardened local and Linux validation workflow coverage for release prep.
- Added and then trimmed the public adapter contract documentation so it describes current adapter boundaries without provider roadmap promises.
- Kept package surface focused on public docs, skills, CLI, and runtime source files.

## 0.2.0-beta.1

### Summary

Patch polish and policy hardening for the public release surface after validation audits.

### Changed

- Updated package metadata to better describe CEWP as a workflow toolkit, not only a skill pack.
- Added npm scripts for harness smoke checks and dry-run package checks.
- Removed stale version wording from fallback install scripts.
- Enforced operator policy for high-impact local CEWP actions: worker execution, reviewer execution, pipeline execution, finalize, cleanup, and prune deletion.
- Kept read-only and dry-run commands available in every policy mode.
- Hardened worker scope guardrails so real worker execution requires explicit `allowedFiles`.
- Hardened parallel worker preflight to catch directory-pattern overlaps such as `docs/**` and `docs/install.md`.
- Hardened `targetWorktree` handling so external, absolute, or traversal paths are rejected unless they resolve inside the CEWP-managed worktree root.
- Hardened dispatch checks and cleanup safety around edited registries that point outside the managed worktree root.

### Release Artifact Hygiene

Public releases should use the npm package or GitHub source archive. Do not share raw local working-directory ZIP exports as release artifacts unless they are cleaned first; local exports may include ignored runtime or private files such as `.cewp/`, `.ctxo/`, or local planning docs.

## 0.2.0-beta.0

### Summary

CEWP now includes a local-first Coordinator Mode runtime for multi-agent engineering workflows, with worktree isolation, dispatch planning, guarded Codex execution, parallel workers, reviewer gate, operator policy modes, harness smoke tests, and modularized CLI internals.

### Added

- Coordinator Mode runtime under `.cewp/runs/<run-id>/`
- Worktree helpers: plan/create/status
- Review packet collection
- Finalize, cleanup, prune helpers
- Dispatch plan/check/prompts/start dry-run
- Guarded `codex-exec` adapter execution
- Sequential and parallel worker execution
- Reviewer execution
- Dispatch pipeline
- Operator policy config:
  - `cewp policy show`
  - `cewp policy set safe`
  - `cewp policy set trusted`
  - `cewp policy set full-authority`
  - `cewp policy reset`
- Harness smoke tests
- Modular `src/**` runtime structure

### Safety

- No automatic merge
- No automatic push
- No automatic publish/release
- Cleanup is dry-run by default
- Finalize requires reviewer `Decision: PASS`
- Worker scope checks include both uncommitted and committed branch changes
- `allowedFiles` / `forbiddenFiles` guardrails remain active
- Full authority mode is supported but does not disable CEWP guardrails

### Verification

- `node --check ./bin/cewp.js`
- `node ./bin/cewp.js --help`
- `node ./bin/cewp.js doctor`
- `node ./bin/cewp.js list`
- `node ./tests/harness/run-smoke.js`
- `npm pack --dry-run`
