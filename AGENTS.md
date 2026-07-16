# CEWP Contributor Instructions

- Preserve CEWP as a Codex-first supervision, governance, and evidence layer. Native Codex is the simpler choice for low-risk one-step work.
- Keep provider expansion paused through 1.0. OpenCode is experimental and maintenance-only; do not add Claude, Gemini, Hermes, or automatic model routing.
- Treat CEWP Core as authoritative for ownership, scope, policy, verification, budgets, reviewer PASS, and finalization. Hooks and UI output are projections only.
- Use one execution owner (`managed`, `native`, or `audit-only`) and one managed backend per checkpoint. Never let host and child execution mutate the same task worktree.
- Keep changes narrow, local-first, and dependency-free unless a dependency has a demonstrated contract-level benefit.
- Run focused contracts while editing, then `npm test`, `npm run check`, `npm run pack:dry-run`, and `git diff --check` before completion.
- Do not publish, tag, release, or weaken a non-waivable gate as part of ordinary feature work.
