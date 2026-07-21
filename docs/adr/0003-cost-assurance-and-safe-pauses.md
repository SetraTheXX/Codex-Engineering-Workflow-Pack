# ADR 0003: Cost, Assurance, Budgets, And Safe Pauses

Status: accepted
Date: 2026-07-16

## Context

Independent planning, repair, verification, and review can use more model operations than a native single-agent goal. CEWP cannot know the exact cost of a future turn, cannot observe every host-internal operation, and must not trade correctness for an arbitrary estimate. It can bound the operations it owns, record supported usage, preserve protected closing work, and stop at a truthful recovery point.

## Decision

Every supervised run selects an assurance profile and an independent test-authoring policy.

- `prototype`: new automated tests are optional, but approved build, smoke, runtime, screenshot, or manual evidence is required. The receipt cannot claim production verification.
- `standard`: the default; one worker, targeted checkpoint verification, regression coverage when justified, a broader final suite, at most two repairs per checkpoint, and independent final review.
- `critical`: test-first or equivalent high-assurance evidence, broader risk-boundary checks, tighter scope and review, and an explicitly approved larger budget.
- `test_authoring` is `auto`, `ask`, or `never`. `never` forbids creating test files, not verification. Creating a new test framework always requires separate approval.

All usage and control values carry exactly one truth label:

- `observed`: reported by a supported, version-tested structured source and stored with source, authentication boundary, timestamp, freshness, model and raw usage categories.
- `estimated`: a range from comparable local history with estimator version, sample count and confidence.
- `budgeted`: an approved maximum or protected allocation CEWP can gate.
- `unknown`: not exposed by the selected host or backend. Unknown is never rendered as zero.

`codex exec --json` usage categories are additive. Uncached input is `input_tokens - cached_input_tokens`; uncached-input, cached-input and output charges are added at their applicable rates. Reasoning usage follows the dated pricing contract without double-counting. Currency is shown only as a dated, model-specific API-equivalent estimate when authentication and pricing semantics make that mapping valid. ChatGPT subscription usage never receives an invented per-run currency amount.

Pre-run estimates are never a point promise. Comparable local runs are grouped by task class, model and effort, assurance, repository-size bucket, checkpoint count, worker/reviewer shape, repairs and verification schedule. Confidence rules are:

- 0-4 comparable runs: no numeric usage estimate.
- 5-9: low confidence and a wide interval.
- 10-24: medium confidence.
- 25 or more: eligible for high confidence after drift checks.

Model, Codex version, estimator, reasoning effort, repository shape or assurance changes invalidate or lower confidence. Calibration stays local by default and stores operational metadata, not prompts, source code or raw logs.

Each approved envelope contains CEWP-controlled model operations, repairs per checkpoint, elapsed time, concurrency, captured log/output volume, targeted verification runs, full verification runs, protected completion/reviewer/finalization allocations, warning thresholds, and an absolute ceiling. Allocations must sum within the approved total and cannot be borrowed silently.

The controls are distinct:

- A soft estimate informs but never stops an in-flight turn.
- The operational budget limits implementation, diagnosis and repair starts.
- The completion reserve is part of the approved total and protects safe checkpoint closure, final verification, independent review and finalization.
- The absolute safety ceiling is never exceeded without a new explicit approval.

The standard preview proposes approximately 20 percent protected capacity, rounded to retain required review/finalization work. Worker operations cannot consume reviewer or finalization allocations.

Default thresholds are 70 percent for an early warning, 90 percent for refusing a new checkpoint and using only an eligible protected allocation, and 100 percent for refusing every new controlled model operation. A finish window exists only inside the pre-approved reserve and never overrides the ceiling, host limits, policy, scope, verification, secret handling or reviewer PASS.

Budget or host exhaustion produces a resumable state, not automatic success or generic failure:

- `paused-budget-safe`: the last checkpoint is verified and no new checkpoint started.
- `paused-budget-unverified`: partial isolated work lacks required verification or review and cannot finalize.
- `paused-host-limit`: a supported host signal or unexpected host stop exhausted availability; trusted and partial work are distinguished.

If optional hook, Apps SDK, notification, or warning delivery fails, CEWP Core still rejects the next controlled operation. Expanding the budget, reducing scope, changing effective model/effort, accepting a waivable exception, rolling back or abandoning requires an operator event. Non-waivable gates remain closed.

Verification is deterministic-first: baseline, smallest relevant check, broader suite at the approved boundary. Failures are classified as new regression, pre-existing, environment/dependency, flaky, invalid test or ambiguous requirement. Logs are bounded. A normalized signature repeated twice or exhausted repair budget transitions to `blocked`; CEWP never weakens or deletes a test merely to open a gate.

## Consequences

Phase 9 implements budgets and accounting before learned estimates. Receipts keep local verification time separate from model-operated work, host limits separate from CEWP budgets, account activity separate from per-run usage, and unavailable native usage explicitly unknown. Estimation is promoted only after pilot data meets the sample and drift rules above.
