# Evidence Receipts

`cewp workflow receipt <run-id>` writes `evidence-receipt.json` and `evidence-receipt.md` under the local
workflow run directory. `--json` wraps the same receipt and paths in `operator-json/v1` for external tools.
Receipt generation does not execute an agent, verification command, or control process.

`evidence-receipt/v1` is a normalized read model over the approved workflow definition, canonical run
state, checkpoints, validated task results, interventions, events, independent reviews, integration control
receipt, and referenced evidence files. It includes:

- goal and source-plan identity;
- workflow digest and revision history;
- operating modes, execution owner, and backend;
- tasks, attempts, changed files, scope verdicts, commands, and verification evidence;
- failure and recovery fields, interventions, review decision, and timestamps;
- observed usage where supported and explicit unknown values otherwise;
- the full approved and consumed budget envelope;
- git base/head identities for new runs;
- warnings and a sorted integrity inventory.

The JSON model is deterministic for unchanged inputs when `generatedAt` is fixed. The CLI timestamp is the
documented variable. Historical runs that predate a field retain an explicit unknown. Runs that are not
finalized, have malformed event/evidence data, or are missing referenced evidence produce a partial receipt
with warnings rather than a complete claim.

The Markdown view is generated from that same model and includes tasks, checkpoints, approved commands and
verification, revisions, interventions/recovery, budget and protected reserves, usage provenance/estimate,
control classifications, final review, timestamps, and warnings. It is intended to explain a run without
requiring raw logs; the JSON remains the machine-readable contract.

## Integrity Boundary

Integrity entries contain byte length and `sha256` for canonical run evidence, the approved definition,
and referenced evidence files. Source identities include workflow/source hashes when available plus git
base and receipt-time head commits. This is `tamper-evident-local-metadata`, not tamper-proof storage: an
attacker who can rewrite both evidence and metadata can replace both. Durable signing or remote attestation
is not implied.

## Privacy Boundary

Raw prompts, adapter output, transcripts, and raw log contents are excluded by default. The receipt may
contain repository-relative paths, changed filenames, approved commands, bounded failure/review summaries,
artifact names, goal/source metadata, host goal identity, revisions, events, timestamps, and reviewer text.
Inspect these fields before sharing.

`cewp workflow export <run-id>` writes separate `.redacted.json`, `.redacted.md`, and `.redacted.html`
artifacts. It removes recognized credential assignments, authorization values, provider-token shapes,
private-key blocks, URL credentials, sensitive/absolute/traversal paths, and active-content markup. It never
overwrites or implicitly creates the canonical receipt. The export records `redaction-policy/v1`, its
replacement count/classes, and that canonical local evidence is still required for integrity verification.
Pattern redaction reduces accidental disclosure but is not a proof that arbitrary prose contains no secret;
inspect exported metadata before sending it outside the repository boundary.

## Event Ledger And Run Health

New workflow lifecycle records use `event/v1`, with a closed type-to-category vocabulary covering run,
revision, task, checkpoint, dispatch, intervention, verification, usage, estimates, budgets, warnings,
pauses, scope, review, cancellation, and finalization. Existing `workflow-event/v1` records are accepted as
read-only legacy input and normalized in receipts; CEWP does not rewrite historical ledgers implicitly.
Core workflow transitions emit distinct budget approval, checkpoint, dispatch, scope, verification, usage,
allocation consumption, threshold/warning, pause, cancellation, review, and finalization records where the
corresponding action occurs.

`cewp run verify <workflow-run-id>` checks canonical state/definition consistency, event syntax and schemas,
required result/checkpoint artifacts, bound-worktree liveness, and every receipt integrity hash. It executes
no agent and no approved verification command. A failed check returns a nonzero exit code while `--json`
still emits the complete `run-verification/v1` diagnostic model.

## Offline Operator Report

`cewp workflow report <run-id>` writes `operator-report.json` and a standalone `operator-report.html` in
the workflow run directory. Both are derived from the same normalized receipt model. The HTML uses no
JavaScript, remote fonts, external stylesheets, network requests, server, or control process, so it can be
opened directly from disk on Windows or Linux.

The report separates observed, estimated, budgeted, and unknown values; shows task progress, revisions,
checkpoint verification, interventions and recovery state, protected reserves, preventive versus observed
controls, and final review. Repository metadata is HTML-escaped, and raw prompts/logs remain excluded.

Task receipts retain the failed checkpoint/classification, blocker, failure history, state history, and the
operator intervention/reason that reopened work. Budget-paused receipts remain partial and separately prove
absolute-ceiling and protected-allocation compliance; a pause is never rendered as completion.

## Run Comparison

`cewp workflow compare <left-run-id> <right-run-id>` derives `run-comparison/v1` from two receipts. It
compares outcome, bounded duration, execution owner/backend, observed usage categories, estimates and API
cost when valid, attempts, interventions, failures, scope, commands, and verification evidence. Model time,
CEWP overhead, estimate accuracy, billing cost, or usage that was not observed remains `unknown` and is
excluded from numeric deltas.

A native-owned workflow is labeled as a native-goal baseline only when a validated host binding includes a
native goal reference. Native ownership alone is insufficient, and unavailable native usage is never zero.

## Usage And Estimate Truth

Each task-result, review-result, and supported host usage record becomes a separate
`usage-observation/v1`. The receipt retains its normalized category, raw category name, observed/imported/
unknown availability, source schema, authentication boundary, timestamp, scope, and effective model only
when known. Bounded raw host payloads are not copied into the receipt. Imported observations stay imported,
do not enter observed totals, and never imply billing impact.

`usage-estimate/v1` records estimator version/method, grouping dimensions, local sample basis, calibration
snapshot, and drift state. With fewer than five comparable runs—or without known model/effort—it remains an
unknown range with unavailable confidence. CEWP does not promote a numeric estimate from fixtures or
non-comparable history.
