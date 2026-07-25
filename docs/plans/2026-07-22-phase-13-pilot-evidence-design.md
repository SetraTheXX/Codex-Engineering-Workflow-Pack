# Phase 13 Pilot Evidence Design

Status: approved 2026-07-22

## Purpose

Phase 13 must make real pilot evidence reviewable without inventing external
participants or adding mandatory telemetry. CEWP will provide a local,
machine-validated pilot ledger and privacy-safe export path. Maintainer
dogfooding remains useful engineering evidence but never satisfies an
independent-user gate.

## Chosen Approach

Pilot records live under the ignored runtime root:

```text
.cewp/pilots/<pilot-id>/record.json
```

The alternatives were tracked public records by default and a documentation-only
process. Public-by-default records create unnecessary privacy risk. A
documentation-only process cannot enforce counting rules or prove which Phase 13
gates remain open. A hosted service was rejected because the product is
local-first and does not require telemetry or an account.

Only an explicit redacted export may leave the local pilot root. Export never
modifies the canonical record and never treats pattern redaction as proof that
arbitrary prose is secret-free.

## Contracts

`pilot-record/v1` is the canonical local record. It contains:

- a stable pilot id and timestamps;
- participant classification: `maintainer-dogfood` or `independent-external`;
- a privacy-safe participant id supplied by the operator;
- repository attempt metadata using language, size, operating-system, test-stack,
  input, risk, and mode buckets rather than an absolute path;
- the bounded task and golden-path outcomes;
- optional CEWP workflow run and receipt-integrity references;
- review, repeat-use, recovery, budget-pause, and controlled-host-limit outcomes;
- native-goal comparison evidence where genuinely comparable;
- onboarding failures, remediation, contributor feedback, and case-study status;
- provenance and warnings for evidence that is missing, malformed, or imported.

`pilot-status/v1` is a derived read model. It reports every Phase 13 gate
separately, its threshold, qualifying evidence ids, exclusions, and remaining
count. It cannot mutate records.

`pilot-export/v1` is a separately written redacted projection. It excludes raw
prompts, source code, logs, credentials, absolute paths, authentication material,
and unbounded free-form participant data.

## CLI Surface

The public commands are:

```text
cewp pilot create
cewp pilot record
cewp pilot status
cewp pilot export
```

`create` writes one validated local skeleton. `record` applies an explicit,
validated observation without silently changing participant classification.
`status` evaluates the complete roadmap gate set and exits nonzero while any
required gate is unmet or invalid. `export` writes a redacted report only after
validation and discloses its redaction policy and counts.

The first vertical slice is `create` plus `status`: a maintainer record can be
created and inspected, but every independent-user count remains zero. Later
slices add observation intake, linked receipt validation, recovery/comparison
evidence, and export.

## Counting And Truth Rules

- Only `independent-external` participants count toward external-participant,
  full-reviewed-run, repeat-user, independent-repository, contribution, and case
  study gates where the roadmap requires independent evidence.
- Multiple machines, repositories, or records belonging to the maintainer do not
  become independent participants.
- A repository attempt is counted once by its stable attempt id. Duplicate ids,
  conflicting participant classifications, or invalid timestamps fail closed.
- A full reviewed run requires linked final evidence and reviewer PASS; a test or
  manually checked box alone is insufficient.
- Native-goal comparisons require equivalent task-shape metadata. Unavailable
  usage remains unknown and is excluded from numeric deltas.
- Recovery, budget exhaustion, and host-limit scenarios are distinct evidence
  categories and cannot substitute for one another.
- No status can report Phase 13 complete unless every roadmap gate has qualifying
  evidence and no unresolved guardrail bypass is recorded.

## Data Flow And Security

The CLI resolves the repository root, then reads or atomically writes only below
`.cewp/pilots`. Pilot ids and export targets are validated against traversal,
absolute paths, reserved names, and symlink escapes. Canonical records use
bounded enums and structured fields instead of arbitrary prose wherever
possible.

Run references are read-only. When a local workflow receipt is linked, CEWP
checks its run identity and integrity metadata; it does not copy raw evidence
files into the pilot record. Missing or stale references remain explicit and do
not qualify a gate.

Export reuses the established redaction boundary, writes repository-relative
artifacts, and requires an operator-selected destination outside the ignored
canonical pilot directory only when the destination is safe. No command sends
data over the network.

## Public Pilot And Contributor Surface

Tracked repository assets will include:

- issue forms for setup failure, workflow failure, feature request, and receipt
  quality;
- a public case-study template with limitations and usage-truth fields;
- updated pilot instructions for manual, privacy-safe adoption milestones;
- contribution guidance, a concise architecture map, contract-extension
  examples, and a private security-reporting path;
- explicit language that ecosystem listing and 1.0 remain gated on real external
  evidence.

Issue forms and templates collect no secrets, raw logs, repository paths, or
mandatory telemetry.

## Error Handling

Malformed JSON, unsupported schema versions, unsafe paths, duplicate identities,
contradictory observations, invalid gate claims, or broken receipt links produce
stable actionable errors. Read-only status remains available where possible and
marks affected evidence invalid rather than discarding it or converting it to
zero. Mutations use atomic writes and preserve the last valid record on failure.

## Testing

Development follows vertical TDD through the public CLI and Core modules:

1. maintainer creation and an honestly incomplete status;
2. independent participant and repository-attempt counting;
3. reviewed run, repeat use, comparison, recovery, budget, host-limit, onboarding,
   contribution, guardrail, and estimate-calibration gates;
4. duplicate, malformed, stale, traversal, symlink, and contradictory evidence;
5. redacted export and adversarial secret/path content;
6. package, help, documentation, Windows, and Linux contract coverage.

Fixtures may prove behavior but never satisfy live pilot gates. The final Phase 13
technical report will therefore distinguish implemented infrastructure from
external evidence still awaiting real users.
