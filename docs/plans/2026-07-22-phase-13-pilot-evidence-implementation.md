# Phase 13 Pilot Evidence Implementation Plan

Status: approved design implementation

## Constraints

- Keep canonical pilot data under ignored `.cewp/pilots` runtime state.
- Never count fixtures or `maintainer-dogfood` as independent evidence.
- Do not add telemetry, a hosted service, another provider, or automatic remote
  actions.
- Use public CLI behavior for contract tests and Core functions for validation.
- Keep the Phase 13 release gate incomplete until genuine external evidence
  proves every threshold.
- Run the private-file tracking scan before every commit.

## Slice 1: Honest Local Pilot Creation And Status

Files:

- `tests/contracts/pilot-record.js`
- `src/pilot/record.js`
- `src/pilot/status.js`
- `src/pilot/cli.js`
- `src/cli/parse.js`
- `src/cli/usage.js`
- `bin/cewp.js`
- `package.json`

TDD behavior:

1. `cewp pilot create --participant maintainer-dogfood --participant-id <id>
   --json` writes `pilot-record/v1` below `.cewp/pilots`.
2. `cewp pilot status --json` returns `pilot-status/v1`, reports the maintainer
   record separately, and leaves every independent-user threshold at zero.
3. Status exits nonzero while Phase 13 gates are unmet but still emits valid JSON.
4. Unsafe ids, missing Git repository roots, duplicate ids, and unsupported
   participant classifications fail with actionable errors.

Focused verification: `npm run test:pilot-record`.

## Slice 2: Structured Observation Intake And Gate Evaluation

Files:

- `tests/contracts/pilot-gates.js`
- `src/pilot/record.js`
- `src/pilot/status.js`
- `src/pilot/cli.js`
- `src/cli/parse.js`
- `package.json`

TDD behavior:

1. `cewp pilot record <pilot-id> --from <observation.json> --yes --json`
   atomically appends a validated observation.
2. Attempts, full reviewed runs, repeat use, native comparisons, recovery,
   operational-budget exhaustion, host limits, onboarding remediation,
   contribution, guardrail, case-study, and calibration evidence are counted only
   when their required structured facts exist.
3. Duplicate attempt ids, participant reclassification, contradictory outcomes,
   invalid timestamps, and impossible PASS claims fail closed.
4. Every roadmap gate exposes threshold, qualifying evidence, excluded evidence,
   status, and remaining count.

Focused verification: `npm run test:pilot-gates`.

## Slice 3: Workflow Receipt Linking

Files:

- `tests/contracts/pilot-receipt-link.js`
- `src/pilot/evidence.js`
- `src/pilot/record.js`
- `src/pilot/status.js`
- `package.json`

TDD behavior:

1. Repository attempts may link a local workflow run without copying raw evidence.
2. A full reviewed run qualifies only when the run identity, final state, receipt
   inventory, required verification, and reviewer PASS agree.
3. Missing, stale, partial, malformed, or integrity-failing receipt links are
   warnings and never qualify a gate.
4. Native-only evidence remains explicitly imported and unknown usage never
   becomes zero.

Focused verification: `npm run test:pilot-receipt-link`.

## Slice 4: Redacted Pilot Export

Files:

- `tests/contracts/pilot-export.js`
- `src/pilot/export.js`
- `src/pilot/cli.js`
- `src/cli/parse.js`
- `package.json`

TDD behavior:

1. `cewp pilot export [<pilot-id>] --json` writes a separate
   `pilot-export/v1` JSON/Markdown projection.
2. Canonical records are not modified and export is never implicit.
3. Absolute paths, traversal, secrets, credentials, raw prompts/logs/source, and
   active markup are excluded or redacted with class/count disclosure.
4. Unsafe output targets and symlink escapes fail closed.

Focused verification: `npm run test:pilot-export`.

## Slice 5: Public Pilot Feedback And Case-Study Surface

Files:

- `.github/ISSUE_TEMPLATE/setup-failure.yml`
- `.github/ISSUE_TEMPLATE/workflow-failure.yml`
- `.github/ISSUE_TEMPLATE/feature-request.yml`
- `.github/ISSUE_TEMPLATE/receipt-quality.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `docs/case-study-template.md`
- `docs/pilot-kit.md`
- `tests/contracts/pilot-public-surface.js`
- `package.json`

TDD behavior:

1. Four issue forms request sanitized reproducible evidence without secrets or
   mandatory telemetry.
2. The case-study template covers task shape, plan quality, checkpoints, overhead,
   truth labels, estimates, interventions, failures, receipt excerpt, and limits.
3. Pilot documentation explains local records, redacted export, honest dogfood,
   and every external gate.

Focused verification: `npm run test:pilot-public-surface`.

## Slice 6: Contributor And Security Surface

Files:

- `CONTRIBUTING.md`
- `SECURITY.md`
- `docs/architecture.md`
- `docs/contract-extension-example.md`
- `tests/contracts/contributor-surface.js`
- `README.md`
- `package.json`

TDD behavior:

1. Contributors have local setup, focused tests, architecture boundaries,
   contract-extension examples, issue selection guidance, and privacy rules.
2. Security reports use a private path and public issues explicitly reject
   secrets and unredacted vulnerabilities.
3. Architecture retains Core authority, one execution owner/backend, and
   provider-neutral contracts.

Focused verification: `npm run test:contributor-surface`.

## Slice 7: Phase 13 Release Surface

Files:

- `tests/contracts/pilot-release.js`
- `docs/release-notes.md`
- `docs/known-limitations.md`
- `README.md`
- `package.json`
- `plugins/cewp/.codex-plugin/plugin.json`

TDD behavior:

1. Prepare `0.13.0-beta.0` locally without publish, tag, or release.
2. Package the reviewed public pilot/contributor files but never `.cewp/pilots`,
   private roadmap files, or `.cewp-private`.
3. Release notes distinguish infrastructure readiness, maintainer dogfood, and
   missing external evidence.
4. Ecosystem submission remains unperformed until real case studies and golden
   path evidence exist.

Focused verification: `npm run test:pilot-release` and package dry runs.

## Batch And Commit Boundaries

Implement and commit in reviewable slices: local ledger/status; observations and
receipt links; redacted export; public pilot/contributor surface; Phase 13 release
preparation. Run focused tests during each red-green-refactor loop, then the full
baseline and privacy scan at the phase checkpoint.
