# ADR 0002: Execution Ownership And Backend Boundaries

Status: accepted
Date: 2026-07-16

## Context

CEWP can dispatch a child Codex process, supervise work performed by a native Codex goal, or import evidence produced elsewhere. Those paths do not provide the same control. Treating them as interchangeable would allow two processes to edit or clean up one worktree and would overstate which policies CEWP enforced before execution.

The Phase 8 capability spike also showed that a CEWP-owned App Server is a separate managed process. It cannot attach plugin code to the ChatGPT desktop app's existing thread merely because both expose App Server-shaped data.

## Decision

Every run records exactly one execution owner before work begins:

- `managed`: CEWP owns worktree creation and cleanup, process dispatch, timeout and best-effort cancellation, artifact collection, and post-execution gates.
- `native`: the supported host owns its thread, goal, process, and worktree. CEWP supervises through documented integration or explicit result intake and claims only the controls it actually performed.
- `audit-only`: another owner performed the work. CEWP validates imported evidence but never labels an observed control as preventive enforcement.

Execution owner and backend are separate fields. A managed run selects exactly one backend for a checkpoint. Phase 9 selects `codex-exec`; App Server remains an experimental capability candidate, not a second simultaneous dispatcher or a fourth owner.

An ownership record contains the run, task and checkpoint identities; owner; backend when managed; worktree identity and root; process or supported host references when known; creation time; status; and cleanup authority. It is written atomically before dispatch. A new operation must reject:

- a second active owner for the same task or worktree,
- a managed backend change while a checkpoint is active,
- host and child mutation of the same task worktree,
- cleanup by anyone other than the recorded owner,
- stale or manually edited ownership data that cannot be validated.

When nested managed dispatch is selected from a ChatGPT/Codex task, the host remains operator-only and the child receives a distinct CEWP-managed worktree. If isolation cannot be proven, CEWP uses the generated native-goal brief or explicit evidence-intake fallback instead of dispatching.

Cancellation is best-effort. A killed or detached process does not make a checkpoint successful. Partial files remain isolated, are collected as partial evidence, and require verification before any later transition. Scope, destructive-operation, secret, verification, and reviewer gates remain authoritative regardless of owner or presentation surface.

## Enforcement Claims

Receipts label each control as one of:

- `preventive`: CEWP checked it before a managed operation.
- `post-execution`: CEWP checked resulting state after execution.
- `imported`: another owner supplied the evidence.
- `unavailable`: the selected boundary could not observe or enforce it.

Native and audit-only runs must not inherit managed claims. A hook or conversation warning may project a decision but never becomes the ownership or enforcement source.

The runtime materializes these classifications as `integration-control-receipt/v1` and exposes the receipt
through `cewp integration controls <workflow-run-id> --json`. Audit-only bindings with preventive entries or
controls assigned to multiple classes are invalid. Imported entries explicitly render as observed, not
enforced, and receipt inspection verifies the artifact still matches its validated host binding.

## Consequences

The runtime needs a deterministic ownership registry and conflict fixtures before the supervised golden path ships. Recovery can safely resume only after worktree, plan, policy, owner, backend, and process state are compatible. App Server may later replace `codex-exec` for a managed checkpoint only through a new capability and migration decision; it cannot run beside it for the same checkpoint.
