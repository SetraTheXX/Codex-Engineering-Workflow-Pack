# Troubleshooting And Recovery

Preserve `.cewp` evidence and inspect status before changing state. Do not delete a
worktree or edit canonical JSON to force progress.

| Condition | Safe response |
| --- | --- |
| Interrupted native goal | Import only supported evidence, keep usage unknown where absent, then resume from the CEWP gate. |
| Failed cancellation or detached host session | Treat ownership as active/unknown, inspect the process and worktree, then explicitly retry, rollback, or abandon. |
| Plan revision | Preview and approve a source-bound revision; completed evidence remains immutable. |
| Deleted worktree | Stop execution, recreate only through the owner-aware worktree path, and re-verify. |
| Ownership conflict or unsafe nested dispatch | Do not dispatch; release, rollback, or abandon the existing owner first. |
| Missing warning surface or outdated plugin | Use CLI JSON/Core status, verify versions, then reinstall the plugin in its documented host. |
| Corrupted events | Run `cewp run verify`; retain the corrupt artifact and repair from a verified backup or explicit migration. |
| Operational/repair budget exhausted | Add budget only with approval or pause; protected reviewer/finalization allocation is not borrowed. |
| Host limit depleted | Record `paused-host-limit`, wait for supported recovery, and never claim PASS. |
| Repeated failure signature | Keep the task blocked and choose revise, bounded retry, rollback, or abandon. |
| Invalid tests or pre-existing failures | Classify them explicitly; never weaken a non-waivable verification gate. |
| Codex execution unavailable | Use documented native intake/manual evidence or restore `codex-exec`; do not substitute another provider. |
| Partial review | Preserve the partial receipt, obtain independent reviewer PASS, then finalize. |

Failed recovery should end in a truthful blocked or resumable state, not fabricated
completion. Back up local evidence before any manual filesystem repair.
