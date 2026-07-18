# Supervised Workflow Pilot Kit

This kit collects real adoption evidence without mandatory telemetry. Do not mark a pilot complete unless a person outside the maintainer's normal environment performs the steps and confirms the result.

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

A Phase 9 external-pilot gate requires at least three independent people to complete the golden path, including at least one real bounded repository task. Deterministic fixtures and maintainer dogfooding are useful engineering evidence but do not count as those people.
