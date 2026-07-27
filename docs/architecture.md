# CEWP Architecture

CEWP supervises long-running Codex work without replacing the host's model loop,
terminal, task UI, or native goal system. CEWP Core is authoritative for every
policy and completion decision; conversation output, hooks, reports, and plugins
are projections of that state.

## Layers

```text
Host surface
  -> Codex plugin (skills, optional hook, local MCP declaration)
    -> CEWP Core (state, policy, budgets, verification, reviewer gates)
      -> Execution bridge (managed codex-exec, supported native intake, audit-only)
      -> Evidence and pilot (receipts, reports, comparisons, local pilot ledger)
```

### Host surface

ChatGPT desktop Codex mode or Codex CLI provides the conversation and task
surface. CEWP does not attach to a private host session or patch native UI.

### Codex plugin

The plugin supplies focused skills, a local stdio MCP bridge, and an optional
review-required evidence hook. These surfaces call Core and cannot reopen a gate.

### CEWP Core

Core owns canonical run state, scope, policy, budgets, task transitions,
verification, reviewer PASS, evidence integrity, and explicit finalization. JSON
state and append-only events are runtime truth; Markdown is derived presentation.

### Execution bridge

Every run has one execution owner and one managed backend where a backend applies.
The supported managed golden path remains `managed` plus `codex-exec`. Native and
audit-only paths use documented bindings or explicit intake and never inherit
managed enforcement claims.

### Evidence and pilot

Workflow receipts, offline reports, comparisons, and redacted exports consume the
same canonical run evidence. Optional pilot records live under `.cewp/pilots/`.
Fixtures and maintainer observations never become external-user proof.

## Contract Boundary

Provider-neutral workflow schemas describe tasks, policy, evidence, and ownership
semantics. Provider-specific identities stay outside the workflow schema in
integration bindings and observations. New host fields remain unknown until a
documented, version-tested boundary exposes them.

CLI, MCP, plugin skills, hooks, reports, and future supported clients use shared
Core services. None may duplicate or weaken scope, budget, verification, reviewer,
or finalization logic.

## Local State

```text
.cewp/workflow-runs/   canonical workflow runtime and evidence
.cewp/supervised-runs/ compatibility supervised runtime
.cewp/pilots/          canonical private pilot records
.cewp/pilot-exports/   explicit redacted pilot projections
../.cewp-worktrees/    managed isolated task worktrees
```

Runtime state is ignored and excluded from the npm package. Public schemas,
documentation, fixtures, and migration code remain tracked and reviewable.
