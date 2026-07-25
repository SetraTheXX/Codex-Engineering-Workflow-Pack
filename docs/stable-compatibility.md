# Stable Compatibility Contract

`cewp compatibility --json` is the canonical `stable-compatibility/v1` projection.
The 1.x candidate supports Node 22, 24, and 26 on the repository Windows and Ubuntu
CI matrix, with Git 2.39 or newer. Codex CLI 0.137.0 is the locally probed baseline;
version or capability drift warns and falls back instead of claiming compatibility.

The supported execution owners are `managed`, `native`, and `audit-only`.
`codex-exec` is the selected managed backend. App Server is experimental and not
graduated, and its fallback is `codex-exec`. Native goal completion is observation,
not CEWP verification or reviewer PASS. Missing host usage remains unknown.

Package and plugin versions must match. Private desktop attachment, persistent native
panels, automatic model routing, and non-Codex provider expansion are not supported.
The command reports `blocked-pilot-evidence` until genuine Phase 13 gates pass.
