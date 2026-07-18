# ADR 0004: Workflow Contract Boundaries

Status: accepted
Date: 2026-07-18

## Context

Phase 9 proves one bounded supervised checkpoint at a time with `supervised-run/v1`, a beta budget envelope, generated Markdown progress, and managed `codex-exec` execution. Phase 10 must support versioned task graphs, plan revision, dependency scheduling, and variable workers without making Markdown executable truth or merging plan, runtime, evidence, and presentation data into one mutable object.

The contract names proposed in the Phase 10 roadmap need stable ownership boundaries before implementation. Existing Phase 9 runs must remain readable, and no schema change may weaken scope, budget, verification, ownership, or reviewer gates.

## Decision

Phase 10 adopts these contract names:

- `workflow-definition/v1`: an approved, declarative workflow revision. It owns the goal, task graph, scopes, stopping conditions, verification policy, assurance, checkpoint policy, budget proposal, execution owner/backend pair, allowed modes, reviewer policy, and revision metadata. It contains no live process state or mutable progress.
- `run-state/v2`: the mutable runtime instance of one approved workflow revision. It owns run and task states, active checkpoints, scheduling decisions, operator interventions, counters, pause/block reasons, effective owner/backend, and references to immutable definition revisions and evidence.
- `task-checkpoint/v1`: the attempt-level gate for one task. It owns baseline identity, allowed scope, verification schedule, attempt count, failure classification, intervention state, result reference, and reviewer requirement. A checkpoint cannot become complete without its required result and verification evidence.
- `budget-envelope/v1`: the approved CEWP-controlled operational budget and its observed counters. It owns allocation maxima, protected completion/reviewer/finalization reserves, thresholds, absolute ceiling, elapsed and verification limits, concurrency, bounded output, host-limit separation, and pause reason. Unknown host usage remains unknown and cannot be converted into observed zero.
- `task-result/v1`: a provider-neutral outcome and evidence index for one task attempt. It owns outcome classification, changed scope, command evidence, usage truth labels, artifacts, timestamps, and provenance. A result is evidence input, not permission to advance state.
- `progress-view/v1`: a derived projection of canonical definitions, run state, checkpoints, results, and events. It may be rendered as JSON or Markdown but is never accepted as a state mutation source.

The schema identifier is an exact contract discriminator, not a loose compatibility hint. Writers emit the current contract. Readers reject unsupported future versions with an actionable message.

## Compiler Boundary

Codex may propose a structured workflow candidate from a prompt, issue, PRD, `PLAN.md`, or `progress.md`. The candidate is untrusted input. CEWP validates identifiers, dependency existence and acyclicity, scope safety and overlap, stopping conditions, verification commands, assurance policy, owner/backend compatibility, budgets, and graph size before it can be approved.

CEWP presents a normalized proposal and source identity for explicit operator approval. It never executes arbitrary prose, Markdown checkboxes, or an unapproved compiler response. Approval records the exact workflow revision and content digest.

## Revision And Migration Boundary

Approved workflow revisions are immutable. A revision creates a new `workflow-definition/v1`, records its parent and reason, retains completed evidence, and previews changes before approval. Historical state is not rewritten in place.

`supervised-run/v1` remains readable through a compatibility projection into `run-state/v2`. The compatibility reader does not silently rewrite the source run. Persisting a migrated run requires an explicit migration command, a preview, and a backup. The Phase 9 single-checkpoint path remains valid while Phase 10 graph commands are introduced incrementally.

## Scheduling And Ownership Boundary

Scheduling is deterministic and dependency-aware. Only tasks whose dependencies completed with required evidence may become ready. Failed, blocked, cancelled, timed-out, or unverified dependencies never open downstream tasks.

Worker count is an approved bounded integer, not a promise of speed. Concurrent tasks require non-overlapping write scopes and compatible budgets. Every checkpoint retains exactly one execution owner and, for managed work, one backend. Phase 10 does not add providers, automatic model routing, a desktop UI, or a second managed backend.

## Consequences

Phase 10 can add graph validation, scheduling, state transitions, revision history, and progress rendering as independent modules with focused contract tests. Existing supervised commands can adopt the contracts through compatibility adapters instead of a flag-day rewrite.

The split adds explicit references between contracts, but it prevents presentation data from becoming authority and keeps provider output separate from gate decisions. Reviewer PASS, policy, scope containment, protected budgets, and explicit finalization remain non-waivable.
