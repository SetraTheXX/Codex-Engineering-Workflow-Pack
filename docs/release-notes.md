# Release Notes

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

## 0.2.0-beta.2

### Summary

Validation and documentation hardening release for the Coordinator Mode dispatch lifecycle after beta.1.

### Changed

- Added deterministic fake Codex lifecycle smoke coverage for worker and reviewer execution without calling real `codex exec`.
- Added failure-path smoke coverage for worker scope violations, adapter non-zero exits, missing reviewer decisions, and reviewer `REQUEST_CHANGES`.
- Improved dispatch pipeline failure summaries with stable step statuses and short failure reasons.
- Hardened local and Linux Dev Node validation workflow coverage for release prep.
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
