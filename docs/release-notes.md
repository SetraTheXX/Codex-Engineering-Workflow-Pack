# Release Notes

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
