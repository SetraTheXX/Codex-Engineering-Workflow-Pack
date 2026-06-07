# Adapter Contract

Status: v0.3 design draft. This document describes the intended adapter provider contract. It does not describe an implemented adapter registry yet.

CEWP currently executes agents through the guarded `codex-exec` adapter. Future versions may support other executors such as Claude Code, Gemini CLI, OpenCode, local models, or custom APIs. The goal of this contract is to keep those providers interchangeable without weakening Coordinator Mode guardrails.

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

## Current Adapter: `codex-exec`

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

The test harness can replace the executable through environment variables so lifecycle tests can run without real `codex exec` calls. That fake executable pattern should become a formal fake/test adapter before adding external providers.

## Adapter Lifecycle

The provider-independent lifecycle should stay stable:

1. Prepare
   - Resolve run, role, task, worktree, prompt path, report path, event path, and adapter-output paths.
   - Run CEWP policy and preflight checks before starting provider execution.

2. Execute
   - Invoke the provider with the prepared prompt and role-specific working directory.
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

## Suggested Adapter Result Shape

Future adapters should return a small structured result:

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

## Role-Based Adapter Config

Future configuration should allow role-specific provider choices without changing the run model:

```json
{
  "adapters": {
    "manager": { "provider": "manual" },
    "worker-a": { "provider": "codex-exec", "timeoutSeconds": 120 },
    "worker-b": { "provider": "codex-exec", "timeoutSeconds": 120 },
    "reviewer": { "provider": "codex-exec", "timeoutSeconds": 120 }
  }
}
```

The same contract should support:
- a manual Manager,
- automated workers,
- a stricter reviewer provider,
- test-only fake execution.

Provider-specific settings should stay behind the adapter boundary. CEWP should continue to reason about roles, tasks, paths, policy, status, and decisions using provider-independent fields.

## Candidate Future Adapters

Manual:
- prints prompts and expected output paths,
- lets a human or external tool perform the work,
- marks execution as `SKIPPED` or waits for user-provided output.

Fake/test:
- deterministic test adapter for harness smoke tests,
- simulates stdout, stderr, last-message, worker reports, events, scope violations, non-zero exit, and reviewer decisions.

`codex-exec`:
- current production adapter,
- should be moved behind the registry after fake/test is formalized.

`claude-code`:
- CLI-backed provider experiment,
- must still write CEWP worker and reviewer outputs.

`gemini-cli`:
- CLI-backed provider experiment,
- must support the same role, output, timeout, and post-check contract.

`opencode`:
- CLI-backed provider experiment for local or configured model workflows.

`custom-api`:
- HTTP or SDK-backed provider,
- should stream or capture output into the same local adapter-output files,
- must not bypass CEWP policy or scope guardrails.

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

## v0.3 Migration Plan

1. Formalize fake/test adapter
   - Move the current fake executable harness behavior into a named test adapter contract.
   - Keep deterministic lifecycle and failure-path smoke coverage.

2. Introduce a minimal adapter registry
   - Register `fake/test` and `codex-exec`.
   - Preserve the existing `--adapter codex-exec` CLI behavior.
   - Do not change runtime file layout.

3. Move `codex-exec` behind the registry
   - Keep current command construction, timeout, stdout/stderr capture, last-message capture, and post-check behavior.
   - Keep existing smoke tests green.

4. Add external adapter experiments
   - Start with CLI-backed adapters before custom APIs.
   - Require the same worker/reviewer output contract.
   - Keep policy, scope checks, reviewer gate, and no-remote-actions constraints unchanged.

5. Add role-based adapter config
   - Allow per-role provider selection.
   - Keep defaults conservative and local-first.
   - Require dry-run previews before actual execution.
