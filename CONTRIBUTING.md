# Contributing To CEWP

CEWP is a Codex-first, local-first supervision and evidence project. Contributions
should improve the guarded Codex path, compatibility, recovery, verification, or
evidence quality. Provider expansion and automatic model routing remain paused
through 1.0.

## Local Setup

Use maintained Node.js 22 or newer and Git:

```bash
node ./bin/cewp.js --help
node ./bin/cewp.js doctor
npm test
```

The runtime has no package dependencies. Do not introduce one unless it produces
a demonstrated contract-level benefit.

## Development Loop

Use one observable behavior at a time:

```text
red test -> smallest green implementation -> refactor -> next behavior
```

Prefer public CLI or Core contracts over private call-count assertions. Start with
the nearest focused command, for example:

```bash
npm run test:pilot-record
npm run test:phase13
npm run check
git diff --check
```

Before claiming completion, run the commands required by the affected contract,
the full suite, package dry-run, and the relevant clean-install/platform gate.

## Contribution Boundaries

- CEWP Core remains authoritative for ownership, scope, policy, verification,
  budgets, reviewer PASS, and finalization.
- Keep exactly one execution owner and one managed backend per checkpoint.
- Keep provider-specific identities outside provider-neutral workflow schemas.
- Do not add providers, desktop UI, terminal servers, private host protocols,
  mandatory telemetry, automatic merge/push/publish/tag/release, or a global skip
  verification switch.
- Treat unknown host usage and billing impact as unknown, never zero.
- Preserve beta read compatibility and add migration tests for format changes.

## Privacy

Do not commit `.cewp/pilots/`, `.cewp/`, `.cewp-private`, credentials, raw prompts,
private logs, or local repository paths. The private `phase-8-to-1.0` roadmap is
not a public package artifact. Before every maintainer commit, the tracking scan
must return no matches:

```bash
git ls-files | rg "phase-8-to-1\.0|\.cewp-private"
```

Redacted exports reduce disclosure risk but do not prove arbitrary prose contains
no secret. Review every export before sharing it.

## Issues And Pull Requests

Choose a `good first issue` only when it has a bounded public behavior, explicit
files or scope, a focused test command, and no private pilot dependency. Useful
starter work includes documentation corrections, deterministic fixture gaps,
clear diagnostics, and narrowly scoped contract tests.

Describe the user-visible outcome, test evidence, migration impact, and any gate
that remains open. A passing test is evidence for the behavior it covers, not a
claim that a whole roadmap phase or real-user pilot succeeded.
