# Release Notes

## Unreleased

No unreleased changes.

## 0.14.0-beta.0 — 2026-07-27

### Summary

Stable-core candidate contracts, recovery/security guidance, CEWP-owned performance
budgets, package lifecycle coverage, maintainer technical acceptance, and a
professional public repository surface. This beta is deliberately not `1.0.0`;
independent user validation is not claimed and stable publication remains a
separate decision.

### Added

- Added `cewp compatibility --json` with `stable-compatibility/v1` covering Node,
  OS, Git, Codex, package/plugin, host claims, modes, owners, backend, and schemas.
- Added explicit downgrade detection plus migration/deprecation guarantees for
  supported beta state and stable candidate schemas.
- Added the 1.0 security re-audit record, failure-recovery guide, contract index,
  native-goal decision guide, and CEWP-controlled performance budgets.
- Added clean package install/upgrade/downgrade-warning/uninstall capability evidence.
- Added local validation and artifact preparation with a hashed manifest; remote
  publication, tag, push, and GitHub release actions remain human-only and absent.
- Added a maintainer-safe manual acceptance guide covering credential-free
  preflight, one bounded real supervised checkpoint, pause/revise/resume, review
  and receipt, ownership conflicts, recovery fixtures, and honest pilot
  classification.
- Added a repository hygiene contract that rejects private planning paths, CEWP
  runtime state, and personal machine identities from the tracked public surface.

### Changed

- Closed Phase 13 under the approved maintainer technical acceptance model while
  preserving verification, reviewer PASS, scope, ownership, policy reset, and
  fail-closed receipt gates.
- Reworked the README and public documentation around product capabilities,
  safety boundaries, aggregate validation, and current limitations.
- Removed local acceptance identifiers, private development plans, machine paths,
  and an obsolete terminal UI architecture plan from the public package.

### Validation truth

- The exact release source passed the repository matrix on Windows and Ubuntu
  across Node.js 22, 24, and 26.
- Phase 13 is complete under the approved maintainer technical acceptance model.
  Independent external evidence was not collected and is not claimed.
- No external participant, repeat-use, case-study, feedback, or contribution
  evidence was fabricated. Phase 13 closure uses maintainer technical acceptance
  and does not claim independent user validation.
- The security review states the local technical finding boundary; it cannot prove
  that no undisclosed external vulnerability exists.

## 0.13.0-beta.0

### Summary

Local, privacy-safe pilot evidence infrastructure and public feedback/contributor
surfaces. This version is prepared locally and is not published, tagged, or
released. Real external-user evidence is absent, so the Phase 13 exit gate remains
open and 1.0 is not validated. Exact clean Linux validation of the current source
also remains required.

### Added

- Added canonical `pilot-record/v1` records under ignored `.cewp/pilots/` state,
  with explicit `maintainer-dogfood` and `independent-external` classification.
- Added `cewp pilot create`, `record`, `status`, and `export` with structured
  observations, complete Phase 13 threshold reporting, atomic writes, duplicate
  evidence refusal, and nonzero incomplete status.
- Added distinct privacy-safe repository and attempt identities, participant-deduped
  repeat-use counts, and fail-safe status warnings for malformed local records.
- Added workflow receipt linking so a full reviewed run qualifies only with a
  finalized run, complete receipt, passing integrity verification, and independent
  reviewer PASS.
- Added separate `pilot-export/v1` JSON/Markdown artifacts with adversarial
  redaction, canonical-record preservation, and symlink containment.
- Added four privacy-aware GitHub issue forms, a case-study template, contributor
  guidance, architecture map, contract-extension example, and private security
  reporting path.

### Validation truth

- Deterministic fixtures prove the pilot contracts but do not count as pilot
  participants, repository attempts, repeat users, reviewed runs, comparisons, or
  case studies.
- Maintainer dogfood is retained and explicitly excluded from independent counts.
- Real external participant, repository, repeat-use, case-study, feedback, and
  contribution evidence is absent; it must be collected later from actual users.
- Ecosystem listing was not submitted because the golden-path evidence and public
  case studies do not yet exist.
- No publish, tag, release, push, PR, merge, telemetry, provider, desktop UI, or
  terminal-server action was added.

## 0.12.0-beta.0

### Summary

Portable, deterministic workflow evidence and offline operator reporting. This version is prepared locally
and is not published, tagged, or released. Exact clean Linux validation remains required before the Phase 12
technical gate can close; Windows validation and cross-platform-safe artifact contracts do not substitute
for that run. Numeric usage confidence also remains unavailable until real comparable local samples meet
the documented calibration and drift thresholds.

### Added

- Added deterministic `evidence-receipt/v1` JSON/Markdown generation for workflow runs with complete-versus-partial truth, task/checkpoint/review evidence, usage unknowns, budget compliance, git identities, and local SHA-256 integrity metadata.
- Added `cewp workflow receipt <run-id>` without executing agents or verification commands. Raw prompts, transcripts, adapter output, and raw log contents remain excluded by default.
- Added the closed `event/v1` lifecycle vocabulary with read-only normalization of historical `workflow-event/v1` records.
- Added read-only `cewp run verify` checks for workflow state, schemas, events, required artifacts, worktree liveness, and receipt integrity.
- Added portable `operator-report/v1` JSON and standalone offline HTML generation from the normalized receipt model.
- Added `run-comparison/v1` and `cewp workflow compare` with explicit unknowns and evidence-backed native-goal baseline labeling.
- Added adversarially tested `redaction-policy/v1` exports that preserve canonical local evidence and avoid absolute-path output.
- Added `usage-observation/v1` provenance/raw-category records and reproducible unknown `usage-estimate/v1` calibration metadata.
- Expanded lifecycle evidence and recovery receipts for failed checkpoints, budget pauses, host limits, cancellations, and audit-only controls.
- Expanded the Markdown receipt so complete and partial runs can be understood without opening raw logs.

### Truth boundaries

- `usage-observation/v1` keeps source schemas, authentication boundaries, raw category names, and observed/imported/unknown states distinct.
- `usage-estimate/v1` keeps its estimator, sample basis, calibration snapshot, and drift state; insufficient evidence produces no numeric range.
- `run-comparison/v1` compares only equivalent observed dimensions. In particular, unavailable native usage remains unknown rather than zero.
- Audit-only controls remain observed-not-enforced and never appear as preventive enforcement.
- API-equivalent currency cost remains unknown without a supported dated model/pricing mapping.
- No publish, tag, or release action was performed.

## 0.11.0-beta.0

### Summary

Codex-first native-goal supervision and integration bridge preparation. Phase 11 keeps managed, native,
and audit-only ownership separate, retains `codex-exec`, adds supported headless integration surfaces,
and preserves provider-neutral workflow state. This version is prepared locally and is not published,
tagged, or released; clean Linux validation remains required before the technical release gate can close.

### Added

- Enforced cross-mode worktree conflicts so native and managed ownership cannot target the same CEWP task worktree or active checkpoint.
- Added explicit implementation, repair, and reviewer task classes with operator-approved model/effort revisions and no automatic model routing.
- Added opt-in, exact-definition and version-bound `SubagentStart`/`SubagentStop` evidence. Hook absence, drift, malformed input, or host distrust leaves Core gates unchanged.
- Added a local stdio bridge with eight Core-backed MCP tools for create, inspect, approve, continue, retry, revise, verify, and finalize. MCP and CLI call the same services and preserve the same Core gates.
- Added MCP protocol-drift negotiation with a stable compatibility warning and CLI/operator-JSON fallback.
- Added structured host observations that keep observed, imported, stale, malformed, unavailable, and unknown truth states distinct without inventing billing impact.
- Added `integration-control-receipt/v1` and `cewp integration controls` so audit-only evidence cannot be presented as preventive enforcement.
- Added a packaged external-integration boundary for third-party MCP/operator JSON clients and rich Codex clients that own a separate App Server lifecycle.

### Changed

- App Server remains ungraduated because no material supported lifecycle, usage, or recovery advantage was proven. An explicit request retains the `codex-exec` fallback.
- Provider-specific host, goal, thread, turn, subagent, and worktree references stay outside provider-neutral workflow schemas.
- Host goal completion, hook completion, and imported evidence never count as CEWP verification or independent reviewer PASS.
- Independent external pilot evidence remains Phase 13 validation debt; fixtures, maintainer dogfood, and multiple machines used by one maintainer do not satisfy it.
- No provider, desktop UI, terminal server, merge, push, publish, tag, or release automation was added.

## 0.10.0-beta.0

### Summary

Codex-first supervised execution and the first versioned workflow graph runtime. The Phase 9 supervised golden path provides one managed `codex-exec` checkpoint with verification, recovery, review, receipts, and truthful budgets. Phase 10 adds source-bound agent compiler requests, approved micro-goal graphs, deterministic scheduling, provider-neutral result evidence, revisions, migrations, and derived progress without making arbitrary prose executable.

### Added

- Added the first managed `codex-exec` supervised checkpoint path: bounded intake, explicit approval, isolated execution, baseline and targeted verification, bounded repair, independent review, receipt preview, and explicit finalize.
- Added manual linear continuation at a verified checkpoint boundary. CEWP seals prior evidence in the isolated worktree, requires complete bounds and fresh approval for the next checkpoint, and keeps the general graph compiler out of this phase.
- Added three thin plugin skills for planning, running, and resuming supervised work plus a credential-free deterministic end-to-end demo.
- Added versioned machine-readable doctor, supervised run, budget, progress, event, and receipt beta surfaces with explicit owner/backend and usage truth labels.
- Added resumable budget-safe, budget-unverified, and host-limit pauses; protected allocations; operator interventions; rollback; and actionable blocked states.
- Added public supervised workflow, known-limitations, and external pilot guides.
- Added `workflow-compiler-request/v1`, `workflow-definition/v1`, `run-state/v2`, `task-checkpoint/v1`, `budget-envelope/v1`, `task-result/v1`, and `progress-view/v1` contract boundaries.
- Added source-bound compiler requests for direct goals, issues, PRDs, `PLAN.md`, and `progress.md`; structured proposals still require schema validation and explicit approval.
- Added deterministic DAG scheduling, bounded numeric worker identities, and credential-free one-, two-, and four-worker workflow contracts.
- Added succeeded and failed task-result intake with scope, verification, usage, output, failure-signature, retry, repeated-failure, and dependency gates.
- Added checkpoint and final independent reviewer gates, canonical budget accounting, derived JSON/Markdown progress, plan revisions, backed-up v1 migration, and three guarded templates.
- Added public workflow runtime documentation whose legal task, checkpoint, and run transitions are checked against the canonical machine tables.

### Changed

- Reframed the public product around long-running goals without blind runs and documented when native Codex goal mode is the simpler choice.
- Enforced `auto`, `ask`, and `never` test-authoring policies independently from required verification evidence.
- Kept OpenCode experimental and outside the golden path; no new provider, desktop UI, terminal server, direct native-goal control, automatic model routing, merge, push, publish, tag, or release behavior was added.
- OpenCode remains experimental and optional; binary/version visibility still does not prove provider, auth, or model readiness.
- Phase 9 technical gates are complete, but independent external pilot evidence remains Phase 13 validation debt; maintainer dogfood does not count as an external participant.
- No provider, desktop UI, terminal server, native-goal control, merge, push, publish, tag, or release automation was added.

## 0.8.0-beta.0

### Summary

Reliability and Codex compatibility foundation for supervised goals. This release repairs Unicode-path installation, adds focused contracts and cross-platform CI, records supported host boundaries, and ships an opt-in read-only Codex plugin skeleton. It does not yet implement the Phase 9 supervised golden path or direct control of native ChatGPT/Codex goals.

### Changed

- Replaced recursive skill copying with a Windows-safe traversal and added a Unicode source-path crash regression contract.
- Added Windows/Linux CI and focused contracts for skills, adapters, provider profiles, operator JSON, artifacts, events, ownership, Core gates, hooks, and deterministic fixtures.
- Published a versioned Codex capability matrix that separates host/plugin access from a separately owned experimental App Server process and selects managed `codex-exec` for the next golden path.
- Defined Codex-first product, execution-ownership, and cost/assurance decisions, including one owner/backend, protected reserves, absolute ceilings, truthful usage labels, and resumable pause states.
- Added official-format skill validation for optional `scripts/`, `references/`, `assets/`, and `agents/openai.yaml` components.
- Added an opt-in local `cewp` plugin skeleton with one read-only run-inspection skill, package metadata, marketplace entry, and isolated install/disable/upgrade/uninstall coverage.
- Raised the next-beta Node.js support floor to maintained Node 22, 24, and 26 lines. The zero-dependency runtime still has no lockfile or package dependency audit graph.
- Kept OpenCode experimental and maintenance-only; no additional provider, standalone desktop UI, terminal server, Apps SDK component, MCP bridge, or native-goal control was added.

## 0.7.0-beta.0

### Summary

Experimental external adapter foundations for Phase 7. This release adds optional OpenCode execution and provider profile read models while keeping provider auth/model readiness unknown until explicitly verified. OpenCode remains experimental; additional providers, desktop UI, terminal servers, and interactive terminal sessions are not implemented.

### Changed

- Added experimental OpenCode model overrides through role config or `CEWP_OPENCODE_MODEL`, including safe argv command construction, dry-run previews, and provider profile/doctor visibility.
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
