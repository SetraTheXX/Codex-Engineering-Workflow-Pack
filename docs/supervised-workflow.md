# Supervised Workflow

CEWP's first supervised path runs one bounded Codex checkpoint at a time in an isolated worktree. A verified checkpoint can be sealed before the operator proposes the next linear checkpoint. CEWP Core owns canonical state and gates; the plugin and Markdown files are presentation surfaces.

## Before You Start

Run diagnostics in the target repository:

```bash
cewp doctor
cewp doctor --json
cewp policy show
```

The current managed path requires a usable Codex CLI, not merely an installed binary. `doctor` keeps binary, authentication, model, host-event, and UI readiness separate.

Use native Codex goals alone for simple low-risk work. Use this workflow when scope, recovery, deterministic verification, independent review, or a receipt justifies the extra operations.

## 1. Plan

Direct goal:

```bash
cewp supervise plan \
  --goal "Update one documented command" \
  --scope docs/install.md \
  --verify "git diff --check" \
  --stop "The command is accurate and the approved check passes" \
  --assurance standard \
  --test-authoring ask
```

Source-backed proposal:

```bash
cewp supervise plan --proposal .cewp-proposal.json --from PLAN.md --source-kind plan
```

Source-backed input records a repository-relative path and content hash. CEWP validates the structured proposal; it does not execute arbitrary Markdown as instructions.

The preview shows goal, scope, stopping conditions, verification, owner/backend, assurance, repair limit, protected allocations, absolute ceiling, and explicit unknown usage fields.

## 2. Approve

```bash
cewp supervise approve <run-id> --yes
```

For `test-authoring: ask`, use a separate explicit decision only when test changes are intended:

```bash
cewp supervise approve <run-id> --allow-test-authoring --yes
```

Changing the goal, scope, checks, or stopping conditions creates a new plan revision and invalidates the old approval.

## 3. Execute And Verify

An optional Codex-specific sidecar can assign an explicit task class without changing the
provider-neutral workflow or run schemas:

```bash
cewp supervise effort <run-id> \
  --operation implementation \
  --task-class demanding-implementation \
  --model <explicit-codex-model> \
  --effort high \
  --yes
```

Supported operations are `implementation`, `repair`, and `reviewer`. Supported task classes are
`fast-exploration`, `demanding-implementation`, and `high-effort-independent-review`. A task class
never selects a model or reasoning effort automatically. Every initial selection or change requires
`--yes`, creates a revision with an operator-approval digest, and fails closed when the sidecar's
approved selection digest no longer matches. Model and effort remain `unknown` when omitted. Explicit selections become known
effective evidence only after supported structured turn-completion usage is received; an early CLI,
model, or host rejection leaves them unknown.

Managed execution is an advanced local action:

```bash
cewp policy set full-authority
cewp supervise execute <run-id> --yes
cewp supervise verify <run-id>
```

CEWP creates one owned worktree, captures a pre-change baseline, dispatches one structured `codex exec` operation, checks file scope and test-authoring policy, then runs targeted verification before any approved full verification.

Failure does not advance progress. One normalized failure can open a bounded repair:

```bash
cewp supervise retry <run-id> --yes
cewp supervise verify <run-id>
```

The same normalized failure twice blocks the checkpoint. Repair count, model operations, local verification runs, elapsed time, and captured output have separate limits.

## 4. Pause, Revise, And Resume

At a verified checkpoint boundary, either continue to final review or pause before proposing one remaining bounded checkpoint:

```bash
cewp supervise pause <run-id> --reason budget-safe --yes
cewp supervise revise <run-id> \
  --goal "Apply the next bounded change" \
  --scope path/to/file \
  --verify "git diff --check" \
  --stop "The next checkpoint passes"
cewp supervise resume <run-id> --yes
cewp supervise approve <run-id> --yes
```

CEWP seals the verified checkpoint on the isolated branch, preserves its canonical evidence, and reuses the same owned worktree. The revised checkpoint requires complete bounds and fresh approval. This is a manual linear continuation, not the general plan compiler or dependency graph.

## 5. Continue, Review, And Finalize

```bash
cewp supervise continue <run-id>
cewp supervise review <run-id> --yes
cewp supervise receipt <run-id>
cewp supervise finalize <run-id> --yes
```

The reviewer runs read-only and independently. `REQUEST_CHANGES`, `BLOCK`, a missing decision, failed verification, scope drift, test-policy drift, or missing evidence closes finalization. Receipt preview comes before explicit finalize.

## Controls

```bash
cewp supervise status <run-id>
cewp supervise revise <run-id> --goal "..." --scope path --verify "..." --stop "..."
cewp supervise pause <run-id> --reason budget-safe --yes
cewp supervise pause <run-id> --reason budget-unverified --yes
cewp supervise pause <run-id> --reason host-limit --note "..." --yes
cewp supervise add-budget <run-id> --operations 1 --allocation repair --yes
cewp supervise resume <run-id> --yes
cewp supervise rollback <run-id> --yes
cewp supervise block <run-id> --reason "..."
cewp supervise cancel <run-id> --yes
cewp supervise abandon <run-id> --yes
```

Every operator intervention is an event. Budget expansion never happens automatically. A warning surface can fail or be absent without reopening a Core gate. `run.json`, generated progress, and receipts retain sealed checkpoint history; only one checkpoint is active at a time.

## Progress And Receipts

Generated files include:

```text
.cewp/supervised-runs/<run-id>/run.json
.cewp/supervised-runs/<run-id>/events.jsonl
.cewp/supervised-runs/<run-id>/progress.md
.cewp/supervised-runs/<run-id>/ownership.json
.cewp/supervised-runs/<run-id>/receipt-preview.json
.cewp/supervised-runs/<run-id>/receipt.json
```

Editing `progress.md` does not mutate `run.json`. Managed token categories are observed only from valid structured turn events. Host-internal usage remains unknown when the selected boundary does not expose it.

## Cleanup

`cewp demo supervised` removes its temporary repository and worktree automatically.

For a real unverified checkpoint, prefer explicit rollback before deleting evidence:

```bash
cewp supervise rollback <run-id> --yes
```

Finalized, cancelled, abandoned, and rolled-back runs retain local evidence by design. Worktree removal automation for supervised runs is not shipped yet; inspect `ownership.json`, use normal `git worktree` commands deliberately, and keep `.cewp/`, `.cewp-worktrees/`, and `.cewp-worker-output/` out of commits.
