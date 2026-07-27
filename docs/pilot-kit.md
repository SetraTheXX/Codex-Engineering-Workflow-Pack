# Supervised Workflow Pilot Kit

This kit collects local adoption evidence without mandatory telemetry. Phase 13 uses
the approved **maintainer technical acceptance** model. Independent user feedback
is optional and must never be fabricated or relabeled as maintainer evidence.

## Local Pilot Ledger

Canonical pilot records stay under the ignored local runtime path
`.cewp/pilots/`. They are never packaged or committed. Create a privacy-safe
record, then add one validated observation at a time:

```bash
cewp pilot create --pilot-id <id> --participant <maintainer-dogfood|independent-external> --participant-id <privacy-safe-id>
cewp pilot record <id> --from <pilot-observation.json> --yes
cewp pilot status --json
cewp pilot export [<id>] --json
```

`cewp pilot status` exits nonzero until every Phase 13 gate has qualifying
evidence. `cewp pilot export` writes a separate redacted JSON/Markdown projection;
it does not change the canonical record, transmit data, or prove arbitrary prose
contains no secret.

A `repository-attempt` observation must use two different privacy-safe identifiers:
`attempt.id` identifies that run, while `attempt.repositoryId` is a stable pseudonym
for the repository. Status keeps distinct `repositoryId` values reviewable.
Malformed or incompatible local records remain visible as invalid warnings and
keep status incomplete.

Technical acceptance requires one repository attempt, one supervised golden path,
one full reviewed run backed by a finalized and integrity-valid receipt, one
measurable benefit observation, one recovered control-flow scenario, and one
guardrail audit with zero unresolved bypasses. Maintainer evidence qualifies for
these gates. Receipt integrity, verification, and independent reviewer PASS remain
fail-closed. Independent user studies remain useful optional product feedback, but
they are not a Phase 13 completion quota.

## Pilot Target

Choose one bounded repository task that can be reviewed independently:

- one documentation correction,
- one focused bug fix,
- one small test-backed behavior change,
- one narrow configuration migration.

Avoid secrets, production deployment, broad rewrites, generated vendor trees, and tasks whose acceptance condition cannot be stated before execution.

## Setup

Record:

```text
Pilot id:
Date:
Participant role:
OS:
Node version:
Git version:
Codex version:
Repository language/size bucket:
Task class:
Authentication boundary: ChatGPT account | API key | unknown
```

Then run:

```bash
cewp doctor --json
cewp demo supervised
```

Do not include authentication files, prompts, source code, raw private logs, or repository paths in a public report.

## Golden Path Observation

Measure manually:

```text
Install completed: yes/no
Doctor actionable: yes/no
Time to proposed checkpoint:
Time to explicit approval:
First approval under five minutes: yes/no
Checkpoint executed: yes/no
Targeted verification result:
Repair attempts:
Pause/revise/resume attempted: yes/no
Prior evidence retained after resume: yes/no
Reviewer decision:
Receipt understandable without raw logs: yes/no
Run finalized: yes/no
Second run completed without maintainer help: yes/no
```

Copy only non-sensitive receipt fields:

```text
Execution owner/backend:
Assurance/test-authoring policy:
Observed CEWP model operations:
Observed token categories available: yes/no
Host-internal usage label:
Budgeted ceiling:
Local verification runs:
Elapsed time:
Warnings or pauses:
Failure/recovery evidence:
```

## Native Goal Comparison

When safe and reasonably equivalent, run a similar low-risk task with native Codex goal mode alone. Record the same outcome fields where the host exposes them. Never replace unavailable native usage with zero.

```text
Comparable task shape:
Native setup time:
CEWP setup time:
Native outcome/recovery:
CEWP outcome/recovery:
Verification failure caught by CEWP:
Independent reviewer finding:
CEWP overhead worth it for this task: yes/no/uncertain
Reason:
```

The comparison is allowed to show no CEWP advantage. CEWP should be chosen only when its control and evidence value justifies the overhead.

## Failure Feedback

Classify the first failure:

```text
setup | diagnostics | plan clarity | approval UX | execution | verification | pause/resume | review | receipt | cleanup
```

Provide the exact public command, sanitized error, expected behavior, actual behavior, and whether the remediation was actionable. Use repository issue forms when available.

## Completion Rule

`cewp pilot status --json` reports completion only when all six maintainer technical
acceptance gates have qualifying structured evidence and no local pilot record is
invalid. Deterministic fixtures prove the contract but are not runtime evidence.
Independent users, when available, must remain classified `independent-external`;
their absence does not block Phase 13.
