# Migration And Deprecation Policy

Stable writers emit the documented current schema. Readers reject unknown future
schemas with an actionable compatibility error. `supervised-run/v1` remains readable
through a read-only projection to `run-state/v2`; execution requires an explicit
previewed migration with digest confirmation and a backup.

Stable 1.x commands and schemas receive a documented deprecation notice for at least
one minor release before removal, unless retaining them would create a P0/P1 security
or data-loss risk. Beta run formats listed in the compatibility contract remain
readable throughout 1.x where a safe projection exists. Migration never silently
rewrites canonical evidence.

An upgrade must preserve supported records. A downgrade warning is mandatory when a
newer writer or schema cannot be safely read by the requested older version; CEWP
must stop instead of modifying that state. Uninstall removes package/plugin files but
does not silently delete `.cewp` evidence or worktrees.
