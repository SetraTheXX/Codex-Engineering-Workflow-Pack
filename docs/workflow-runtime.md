# Workflow Runtime

The workflow runtime turns a bounded goal or repository document into an approved, versioned task graph. It is a local-first control surface around engineering work, not a model host or a prose interpreter.

`cewp workflow compile` creates an agent request and does not execute prose, call a model, or create canonical run state. A host agent or operator supplies a structured candidate. CEWP validates that candidate, shows a proposal, and requires explicit approval before creating a run.

The Phase 10 managed owner/backend pair remains `managed` plus `codex-exec`. OpenCode remains experimental and is outside this workflow path. The runtime does not merge, push, publish, or tag. It also does not attach to private ChatGPT tasks, control native goals, add a desktop UI, or add providers.

## Contracts

- `workflow-compiler-request/v1` binds an agent prompt to a direct goal or repository source snapshot.
- `workflow-definition/v1` is the immutable approved graph, policy, scope, verification schedule, and proposed budget.
- `run-state/v2` is canonical mutable runtime state for one approved definition revision.
- `task-checkpoint/v1` is the attempt-level scope, budget, evidence, failure, and optional reviewer gate.
- `budget-envelope/v1` separates approved allocations, protected reserves, thresholds, observed counters, and host limits.
- `task-result/v1` records either a succeeded or failed provider-neutral outcome, scoped files, verification evidence, usage truth, artifacts, and failure evidence.
- `progress-view/v1` is a derived projection. Its JSON and Markdown forms never mutate canonical state.

## Approval Flow

1. Run `cewp workflow compile --goal <text>` or `cewp workflow compile --from <issue|PRD|PLAN.md|progress.md>`.
2. Give the returned compiler request to the host agent and save its `workflow-definition/v1` response.
3. Run `cewp workflow propose --proposal <file> ... --compiler-digest <digest>`.
4. Inspect the normalized graph, source identity, scopes, checks, and budget.
5. Run the exact `cewp workflow approve ... --digest <digest> --yes` command from the proposal.
6. Use `workflow status`, `workflow start`, and `workflow result` one bounded checkpoint at a time.
7. Record checkpoint or final independent review when the definition requires it, then finalize explicitly.

Arbitrary Markdown is never canonical execution input. Source drift invalidates compiler and approval digests. Generated `progress.md` is disposable presentation and cannot be submitted as a state update.

## Results And Recovery

A succeeded `task-result/v1` must include every approved baseline, targeted, and full verification command with passing evidence. Scope or forbidden-file violations fail closed. A configured checkpoint review keeps the task in `review-pending` until a scope-bound independent PASS arrives.

A failed `task-result/v1` is still evidence. CEWP validates its scope, approved verification commands, failure classification and signature, bounded output, and usage truth. It persists the result, accounts observed CEWP-controlled operations, and moves the checkpoint, task, and run to `blocked`. An identical canonical signature is derived as `repeated-failure`; a provider cannot self-declare it. Unknown host-internal work remains unknown and is not fabricated as observed usage.

Recovery is explicit: retry, revise, reassign, a permitted pre-existing-failure waiver, rollback, cancel, or abandon. New regressions, repeated failures, scope gates, destructive-operation policy, and required reviewer PASS are non-waivable. A failed or unverified checkpoint never counts as completed.

## Budgets

Implementation, repair, completion, reviewer, and finalization allocations sum to the absolute model-operation ceiling. Completion, reviewer, and finalization allocations are protected. Reviewer capacity must cover every configured checkpoint review plus a configured final review.

CEWP warns at the approved early threshold, refuses a new implementation operation at the reserve threshold, and refuses every controlled operation above the absolute ceiling. Output, targeted verification, full verification, elapsed time, concurrency, and repair attempts have independent bounds. A refusal creates `paused-budget-safe`, `paused-budget-unverified`, or `paused-host-limit`; it never creates PASS.

## Revisions And Migration

`workflow revise` previews a new immutable definition and graph diff. `workflow apply-revision` requires the preview digest and source identity, retains completed evidence, archives previous task state, writes a backup, and records why the graph changed.

Existing `supervised-run/v1` runs remain readable through a read-only `run-state/v2` projection. `workflow migrate` previews first, then requires a source-bound digest and explicit approval. The legacy source is never rewritten and a byte-exact backup is retained before a new v2 run is persisted.

## Task Transitions

- `pending + dependencies-satisfied -> ready`
- `pending + block -> blocked`
- `pending + cancel -> cancelled`
- `pending + rollback -> rolled-back`
- `pending + abandon -> abandoned`
- `ready + start -> running`
- `ready + revise -> ready`
- `ready + reassign -> ready`
- `ready + block -> blocked`
- `ready + cancel -> cancelled`
- `ready + rollback -> rolled-back`
- `ready + abandon -> abandoned`
- `running + result-recorded -> verifying`
- `running + baseline-failure -> blocked`
- `running + new-regression -> blocked`
- `running + pre-existing-failure -> blocked`
- `running + environment-failure -> blocked`
- `running + dependency-failure -> blocked`
- `running + flaky-result -> blocked`
- `running + invalid-test -> blocked`
- `running + ambiguous-requirement -> blocked`
- `running + repeated-failure -> blocked`
- `running + non-waivable-gate -> blocked`
- `running + block -> blocked`
- `running + timeout -> timed-out`
- `running + cancel -> cancelled`
- `running + rollback -> rolled-back`
- `running + abandon -> abandoned`
- `verifying + verification-passed -> completed`
- `verifying + verification-passed-review-required -> review-pending`
- `verifying + baseline-failure -> blocked`
- `verifying + new-regression -> blocked`
- `verifying + pre-existing-failure -> blocked`
- `verifying + environment-failure -> blocked`
- `verifying + dependency-failure -> blocked`
- `verifying + flaky-result -> blocked`
- `verifying + invalid-test -> blocked`
- `verifying + ambiguous-requirement -> blocked`
- `verifying + repeated-failure -> blocked`
- `verifying + non-waivable-gate -> blocked`
- `verifying + block -> blocked`
- `verifying + timeout -> timed-out`
- `verifying + cancel -> cancelled`
- `verifying + rollback -> rolled-back`
- `verifying + abandon -> abandoned`
- `review-pending + reviewer-pass -> completed`
- `review-pending + reviewer-block -> blocked`
- `review-pending + timeout -> timed-out`
- `review-pending + cancel -> cancelled`
- `review-pending + rollback -> rolled-back`
- `review-pending + abandon -> abandoned`
- `blocked + retry -> ready`
- `blocked + revise -> ready`
- `blocked + reassign -> ready`
- `blocked + waive -> ready`
- `blocked + rollback -> rolled-back`
- `blocked + cancel -> cancelled`
- `blocked + abandon -> abandoned`
- `failed + retry -> ready`
- `failed + revise -> ready`
- `failed + rollback -> rolled-back`
- `failed + abandon -> abandoned`
- `timed-out + retry -> ready`
- `timed-out + revise -> ready`
- `timed-out + rollback -> rolled-back`
- `timed-out + cancel -> cancelled`
- `timed-out + abandon -> abandoned`
- `completed + reviewer-block -> blocked`
- `completed + rollback -> rolled-back`
- `cancelled + rollback -> rolled-back`
- `cancelled + abandon -> abandoned`
- `rolled-back + abandon -> abandoned`

## Checkpoint Transitions

- `running + result-recorded -> result-recorded`
- `running + baseline-failure -> blocked`
- `running + new-regression -> blocked`
- `running + pre-existing-failure -> blocked`
- `running + environment-failure -> blocked`
- `running + dependency-failure -> blocked`
- `running + flaky-result -> blocked`
- `running + invalid-test -> blocked`
- `running + ambiguous-requirement -> blocked`
- `running + repeated-failure -> blocked`
- `running + non-waivable-gate -> blocked`
- `running + block -> blocked`
- `running + timeout -> timed-out`
- `running + cancel -> cancelled`
- `running + rollback -> rolled-back`
- `running + abandon -> abandoned`
- `result-recorded + verification-passed -> verified`
- `result-recorded + baseline-failure -> blocked`
- `result-recorded + new-regression -> blocked`
- `result-recorded + pre-existing-failure -> blocked`
- `result-recorded + environment-failure -> blocked`
- `result-recorded + dependency-failure -> blocked`
- `result-recorded + flaky-result -> blocked`
- `result-recorded + invalid-test -> blocked`
- `result-recorded + ambiguous-requirement -> blocked`
- `result-recorded + repeated-failure -> blocked`
- `result-recorded + non-waivable-gate -> blocked`
- `result-recorded + block -> blocked`
- `result-recorded + timeout -> timed-out`
- `result-recorded + cancel -> cancelled`
- `result-recorded + rollback -> rolled-back`
- `result-recorded + abandon -> abandoned`
- `blocked + rollback -> rolled-back`
- `blocked + cancel -> cancelled`
- `blocked + abandon -> abandoned`
- `timed-out + rollback -> rolled-back`
- `timed-out + abandon -> abandoned`
- `verified + reviewer-block -> blocked`
- `verified + rollback -> rolled-back`
- `cancelled + rollback -> rolled-back`
- `cancelled + abandon -> abandoned`
- `rolled-back + abandon -> abandoned`

## Run Transitions

- `approved + task-started -> active`
- `approved + pause-budget-safe -> paused-budget-safe`
- `approved + cancel -> cancelled`
- `approved + abandon -> abandoned`
- `active + task-started -> active`
- `active + pause-budget-safe -> paused-budget-safe`
- `active + pause-budget-unverified -> paused-budget-unverified`
- `active + pause-host-limit -> paused-host-limit`
- `active + block -> blocked`
- `active + tasks-completed -> review-pending`
- `active + tasks-completed-no-review -> completed`
- `active + cancel -> cancelled`
- `active + timeout -> timed-out`
- `active + abandon -> abandoned`
- `paused-budget-safe + resume -> active`
- `paused-budget-safe + add-budget -> active`
- `paused-budget-safe + reduce-scope -> active`
- `paused-budget-safe + rollback -> rolled-back`
- `paused-budget-safe + cancel -> cancelled`
- `paused-budget-safe + abandon -> abandoned`
- `paused-budget-unverified + resume -> active`
- `paused-budget-unverified + add-budget -> active`
- `paused-budget-unverified + reduce-scope -> active`
- `paused-budget-unverified + rollback -> rolled-back`
- `paused-budget-unverified + cancel -> cancelled`
- `paused-budget-unverified + abandon -> abandoned`
- `paused-host-limit + resume -> active`
- `paused-host-limit + rollback -> rolled-back`
- `paused-host-limit + cancel -> cancelled`
- `paused-host-limit + abandon -> abandoned`
- `blocked + retry -> active`
- `blocked + revise -> active`
- `blocked + reassign -> active`
- `blocked + waive -> active`
- `blocked + rollback -> rolled-back`
- `blocked + cancel -> cancelled`
- `blocked + abandon -> abandoned`
- `timed-out + retry -> active`
- `timed-out + resume -> active`
- `timed-out + rollback -> rolled-back`
- `timed-out + cancel -> cancelled`
- `timed-out + abandon -> abandoned`
- `review-pending + pause-budget-safe -> paused-budget-safe`
- `review-pending + pause-host-limit -> paused-host-limit`
- `review-pending + reviewer-pass -> completed`
- `review-pending + reviewer-block -> blocked`
- `review-pending + cancel -> cancelled`
- `review-pending + abandon -> abandoned`
- `completed + finalize -> finalized`
- `completed + rollback -> rolled-back`
- `cancelled + rollback -> rolled-back`
- `cancelled + abandon -> abandoned`
- `rolled-back + abandon -> abandoned`
