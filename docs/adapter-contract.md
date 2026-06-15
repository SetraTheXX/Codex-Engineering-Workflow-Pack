# Adapter Contract

Status: public contract note. This document describes the adapter boundary used by Coordinator Mode.

CEWP currently supports the guarded `codex-exec` execution adapter and a non-executing `manual` adapter. The goal of this contract is to make the execution boundary clear without weakening Coordinator Mode guardrails. CEWP includes a minimal adapter registry and role-based config normalization foundation. External AI provider support is not implemented by this document.

## What Is A CEWP Adapter?

A CEWP adapter is the provider-specific execution layer between Coordinator Mode and an agent runtime.

The adapter should:
- receive a prepared dispatch prompt,
- execute it for a specific role,
- write provider output into expected local files,
- return an execution result that CEWP can summarize.

The adapter should not own:
- task scope policy,
- `allowedFiles` or `forbiddenFiles` enforcement,
- reviewer decision gates,
- finalize,
- cleanup,
- merge, push, publish, release, or tag actions.

Those controls remain CEWP responsibilities.

## Current Adapters

### `codex-exec`

The current production adapter is `codex-exec`.

It runs:

```txt
codex exec --cd <worktree> --sandbox <sandbox> --output-last-message <path> <prompt>
```

Current behavior:
- worker execution runs in the assigned worker worktree,
- reviewer execution runs against the run context,
- stdout is captured under `adapter-output/`,
- stderr is captured under `adapter-output/`,
- the last assistant message is captured under `adapter-output/`,
- worker reports are copied from `.cewp-worker-output/` into the run directory,
- post-checks run after provider execution.

The test harness can replace the executable through environment variables so lifecycle tests can run without real `codex exec` calls.

### `manual`

The `manual` adapter is a non-executing handoff adapter.

It does not call Codex, external AI tools, local models, or provider CLIs. For dispatch execution, it writes a role-specific handoff prompt under:

```txt
.cewp/runs/<run-id>/manual/<role>.md
```

It also writes an adapter last-message marker explaining that manual action is required. Dispatch output prints the selected provider, the handoff artifact path, and `External command: not executed`. The result fails closed because CEWP has not performed the worker or reviewer work automatically.

After a human completes the handoff, `cewp run dispatch complete <role> --from <file>` records the provided result text into the role's expected CEWP output path. Worker roles write `reports/<role>-report.md`; the reviewer role writes `reviews/reviewer-report.md`. The command also writes a last-message marker and event entry, but it does not bypass scope checks or the reviewer decision gate.

## Adapter Registry And Config Foundation

CEWP has a minimal internal adapter registry. The registry currently supports:

```txt
codex-exec
manual
```

Dispatch execution resolves the selected provider through a role-aware config normalization helper before looking it up in the registry. The recognized roles are:

```txt
manager
worker-a
worker-b
reviewer
```

The default normalized config maps every recognized role to `codex-exec`. Unsupported providers fail through registry validation. Unknown roles fail with a clear role validation error.

CEWP may also read an optional root-level `cewp.config.json` file. Only the top-level `adapters` field is used:

```json
{
  "adapters": {
    "manager": { "provider": "codex-exec" },
    "worker-a": { "provider": "codex-exec" },
    "worker-b": { "provider": "codex-exec" },
    "reviewer": { "provider": "codex-exec" }
  }
}
```

When the file is missing, CEWP keeps the default `codex-exec` provider for every role. A CLI `--adapter` value overrides the selected role. Invalid JSON fails with a clear `Invalid cewp.config.json JSON` message, and unsupported providers fail through the adapter registry. Supported providers are `codex-exec` and `manual`; external provider implementations are not included.

`cewp doctor` reports the adapter config source and resolved provider for each role.

## Adapter Lifecycle

The provider-independent lifecycle should stay stable:

1. Prepare
   - Resolve run, role, task, worktree, prompt path, report path, event path, and adapter-output paths.
   - Run CEWP policy and preflight checks before starting provider execution.

2. Execute
   - Invoke the provider with the prepared prompt and role-specific working directory, or write a non-executing manual handoff when using `manual`.
   - Use role-appropriate sandbox or permission settings.
   - Respect timeout settings.

3. Capture stdout/stderr
   - Write provider stdout to `adapter-output/<role>-stdout.log`.
   - Write provider stderr to `adapter-output/<role>-stderr.log`.

4. Capture last-message
   - Write the provider's final assistant message to `adapter-output/<role>-last-message.md` when supported.
   - If a provider cannot expose last-message, the adapter must report that clearly.

5. Copy worker output
   - For worker roles, copy `.cewp-worker-output/<role>-report.md` into `reports/<role>-report.md`.
   - For worker roles, append `.cewp-worker-output/<role>-events.jsonl` into `events/<role>.jsonl` when present.

6. Post-check
   - Re-read git status and committed changes since the registered `baseCommit`.
   - Enforce `allowedFiles` and `forbiddenFiles`.
   - Confirm report and adapter output paths exist.
   - For reviewer execution, confirm the reviewer did not mutate the public repo and wrote a valid decision report.

7. Report result
   - Return a structured result to dispatch orchestration.
   - Print a stable human-readable summary.
   - Append run events with role, adapter, status, exit code, copied output, and decision when relevant.

## Worker Output Contract

Workers write local handoff output inside their assigned worktree:

```txt
.cewp-worker-output/<role>-report.md
.cewp-worker-output/<role>-events.jsonl
```

CEWP copies or appends that output into:

```txt
.cewp/runs/<run-id>/reports/<role>-report.md
.cewp/runs/<run-id>/events/<role>.jsonl
```

The worker report should include:
- role,
- task id or title,
- status,
- summary,
- changed files,
- commands run,
- test results,
- risks,
- handoff notes.

The events file should be JSON Lines. Each line should be a small event object. Providers may include provider-specific fields, but should keep common fields such as `role`, `task`, `event`, and `status` when possible.

## Reviewer Output Contract

Reviewers write directly into the run directory:

```txt
.cewp/runs/<run-id>/reviews/reviewer-report.md
.cewp/runs/<run-id>/events/reviewer.jsonl
```

The reviewer report must contain exactly one reviewer decision line:

```txt
Decision: PASS
Decision: REQUEST_CHANGES
Decision: BLOCK
```

Finalize requires `Decision: PASS`. `REQUEST_CHANGES`, `BLOCK`, and missing or invalid decisions must block finalize.

## Adapter Output Contract

Every provider should write or let CEWP write these files:

```txt
.cewp/runs/<run-id>/adapter-output/<role>-stdout.log
.cewp/runs/<run-id>/adapter-output/<role>-stderr.log
.cewp/runs/<run-id>/adapter-output/<role>-last-message.md
```

For providers that do not support a native last-message output, CEWP should either:
- synthesize one from the final response, or
- mark the missing path as a failure or explicit unsupported capability.

Silent missing output should be avoided.

## Adapter Result Shape Draft

Adapter execution is summarized internally as a small structured result:

```json
{
  "adapter": "codex-exec",
  "role": "worker-a",
  "status": "PASS",
  "exitCode": 0,
  "timedOut": false,
  "reason": "",
  "reasons": [],
  "paths": {
    "stdout": ".cewp/runs/<run-id>/adapter-output/worker-a-stdout.log",
    "stderr": ".cewp/runs/<run-id>/adapter-output/worker-a-stderr.log",
    "lastMessage": ".cewp/runs/<run-id>/adapter-output/worker-a-last-message.md",
    "report": ".cewp/runs/<run-id>/reports/worker-a-report.md",
    "events": ".cewp/runs/<run-id>/events/worker-a.jsonl"
  }
}
```

`status` values:
- `PASS`: provider execution and CEWP post-checks passed.
- `FAIL`: provider execution or CEWP post-checks failed.
- `SKIPPED`: CEWP intentionally did not run the provider.

`reason` should be a short single-line reason for summaries. `reasons` may include detailed post-check failures such as adapter non-zero exit, timeout, missing report, forbidden file change, or outside-allowedFiles change.

## Adapter Availability

`codex-exec` includes a side-effect-free availability check. `manual` reports itself available because it only writes local handoff files and does not execute external commands.

The check:
- accepts `CEWP_CODEX_EXEC_COMMAND` as an explicit command override,
- validates `CEWP_CODEX_EXEC_PREFIX_ARGS` shape when present,
- otherwise checks whether the `codex` executable is available with a safe version check,
- reports a short reason when the executable is missing.

`cewp doctor` reports adapter availability as informational output. Actual dispatch execution can fail before starting a provider process when the selected adapter is unavailable. Dry-run previews remain side-effect-free.

## Provider-Neutral Boundary

Provider-specific execution details should stay behind the adapter boundary. CEWP should continue to reason about roles, tasks, paths, policy, status, and decisions using provider-independent fields.

Any provider-specific implementation must produce or allow CEWP to produce the same local output files, result status, and post-check evidence described above.

## Security Boundaries

Adapters must not disable CEWP guardrails.

Required boundaries:
- CEWP policy enforcement stays in CEWP.
- `allowedFiles` and `forbiddenFiles` post-checks stay in CEWP.
- Committed and uncommitted scope checks stay in CEWP.
- Reviewer `Decision: PASS` remains required for finalize.
- Push, publish, release, tag, and merge actions are not automatic adapter actions.
- Cleanup and prune safety remain CEWP-owned.
- Adapter-specific credentials or secrets must not be printed in logs.

Adapters can fail closed. If output is missing, a timeout occurs, the provider exits non-zero, or the provider changes files outside scope, CEWP should report `FAIL` and leave finalize unavailable.
