# Manual CEWP Acceptance

This guide is for the maintainer or a pilot participant testing CEWP in a disposable
repository. Use a fresh branch or clone, keep secrets out of prompts and fixtures,
and review every command before approving execution.

Maintainer testing must be recorded as `maintainer-dogfood`. It is useful technical
evidence, but it does not count as independent Phase 13 validation.

## Credential-free preflight

From the CEWP source repository:

```powershell
node .\bin\cewp.js --help
node .\bin\cewp.js doctor --json
node .\bin\cewp.js compatibility --json
npm run test:clean-install
npm run test:plugin-lifecycle
```

Expected: help renders, doctor is actionable, compatibility reports
`blocked-pilot-evidence`, clean install/demo/uninstall passes, and the isolated
plugin lifecycle installs, disables, upgrades, and removes without creating auth.

## Supervised checkpoint

Use a disposable target repository containing a committed `README.md`. The following
path invokes real managed Codex execution, so keep the task narrow:

```powershell
cewp supervise plan --goal "Add one clearly labeled manual-acceptance note to README.md" --scope README.md --verify "git diff --check" --stop "The note is present and git diff --check passes" --json
cewp supervise approve <run-id> --yes --json
cewp supervise execute <run-id> --yes --json
cewp supervise verify <run-id> --json
```

Expected: the proposal is explicit, approval is required before execution, only the
approved file changes, and host completion alone does not mark verification PASS.
Stop if the plan or worktree is not the intended disposable target.

## Pause, revise, and resume

Before finalization, exercise a controlled pause and a source-bound revision:

```powershell
cewp supervise pause <run-id> --reason budget-safe --yes --json
cewp supervise status <run-id> --json
cewp supervise resume <run-id> --yes --json
cewp supervise revise <run-id> --goal "Keep the same bounded README note and clarify its wording" --json
```

Expected: pause is truthful and resumable, completed evidence remains present, resume
returns to the exact prior gate, and revision requires review rather than silently
changing the approved scope.

## Independent review and receipt

After execution and verification:

```powershell
cewp supervise review <run-id> --yes --json
cewp supervise receipt <run-id> --json
cewp supervise finalize <run-id> --yes --json
```

Expected: finalize refuses missing verification or reviewer PASS. The JSON/Markdown
receipt identifies owner/backend, scope, verification, review, usage provenance,
unknown host usage, and integrity metadata without copying raw prompts or secrets.

## Ownership conflict

In the CEWP development repository, run:

```powershell
npm run test:ownership-gates
npm run test:integration-binding
```

Expected: managed and native ownership cannot target the same task worktree, unsafe
nested dispatch fails closed, and released/abandoned ownership is explicit. Do not
simulate this by starting two real agents against the same worktree.

## Failure and recovery

Run the deterministic recovery contracts:

```powershell
npm run test:supervised-failure
npm run test:supervised-controls
npm run test:workflow-failure-matrix
npm run test:workflow-lifecycle
```

Expected: repeated signatures stop, operational/host limits create resumable states,
protected reviewer allocation is not borrowed, partial evidence survives, and no
failure path manufactures reviewer PASS.

## Pilot evidence

Record maintainer testing honestly:

```powershell
cewp pilot create --pilot-id maintainer-manual-1 --participant maintainer-dogfood --participant-id maintainer-1 --json
cewp pilot status --json
cewp pilot export maintainer-manual-1 --json
```

Expected: status remains incomplete and the maintainer record is excluded from
independent counts. Canonical records stay under ignored `.cewp/pilots/`; export is a
separate redacted projection. A future external participant must use a privacy-safe
independent identity and confirm their own real repository outcome.

## What must not be claimed

- A passing fixture is not an external user, repository attempt, or case study.
- Native host completion is not CEWP verification or reviewer PASS.
- Missing, stale, or malformed host usage is not zero.
- A Windows pass does not prove the exact Linux release matrix.
- Artifact preparation is not publication, tagging, pushing, or a GitHub release.
- `1.0.0` is not eligible until every real Phase 13 gate and release matrix passes.

Capture sanitized command output, CEWP version, OS/Node/Git/Codex versions, expected
versus actual behavior, recovery result, and the final receipt. Never include tokens,
auth files, raw private prompts, source code, or absolute private repository paths in
a public report.
