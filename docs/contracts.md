# Stable Contract Reference

The machine-readable index is `cewp compatibility --json`. Core owns workflow
definitions, run state, ownership, budgets, scope, verification, review, receipts,
events, and finalization. CLI, MCP, hooks, plugin conversation output, and reports are
projections over those services and cannot bypass their gates.

Stable candidate schemas include `workflow-definition/v1`, `run-state/v2`,
`task-result/v1`, `event/v1`, and `evidence-receipt/v1`. Pilot schemas remain honest
evidence contracts but cannot make external observations exist. See
`migration-policy.md` for read compatibility and deprecation guarantees and
`external-integration-boundary.md` for MCP/host boundaries.
