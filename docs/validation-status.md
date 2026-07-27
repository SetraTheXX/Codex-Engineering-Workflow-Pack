# Validation Status

CEWP publishes validation claims at the product level. Local run identifiers,
machine paths, raw logs, private plans, and participant identities are not part of
the public repository.

## Current Candidate

- Package: `0.14.0-beta.1`
- GitHub release target: `v0.14.0-beta.1`
- npm publication target: `0.14.0-beta.1`
- Codex plugin distribution: source-checkout marketplace only
- Managed backend: `codex-exec`
- Supported Node.js majors: 22, 24, and 26
- Repository CI: Windows and Ubuntu
- Technical acceptance: complete
- Independent user validation: not claimed
- Publication status: GitHub prerelease; not released as `1.0.0`

Registry state can change independently of the repository. Query the live
distribution tags before installation:

```bash
npm view @setrathex/codex-engineering-workflow-pack dist-tags --json
```

`cewp compatibility --json` is the canonical machine-readable compatibility
projection. A release still requires validation of the exact final source,
matching package and plugin versions, reviewed package contents, and explicit
human approval for publish, tag, and release actions.

## Non-Waivable Evidence

A completed managed run requires approved scope, CEWP verification, independent
reviewer PASS, a complete receipt, released worktree ownership, and an explicit
finalize action. Missing or malformed evidence remains incomplete.

## Privacy Boundary

Pilot records and runtime state remain local under ignored CEWP directories.
Public documentation reports aggregate capabilities and limitations only. It does
not publish local paths, raw prompts, source repositories, authentication data, or
private operator logs.
