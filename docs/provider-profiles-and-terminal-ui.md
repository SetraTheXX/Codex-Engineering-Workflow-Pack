# Provider Profiles And Terminal Orchestration UI

Status: planning document. This is a product architecture plan for future CEWP provider profiles and operator UI support. It does not implement a desktop UI, terminal server, WebSocket layer, or new provider adapter.

CEWP currently supports:
- `codex-exec`: guarded one-shot execution through the Codex CLI.
- `manual`: non-executing human handoff and result intake.
- `opencode`: experimental OpenCode execution MVP.

OpenCode remains experimental. Local dogfood showed that binary availability is not enough to prove provider auth, model, or subscription readiness. Future provider support must therefore make provider configuration explicit instead of depending on any CLI's default model state.

## Product Direction

CEWP is moving toward a local-first engineering workflow runtime that can coordinate agents, terminals, artifacts, timeline, and review gates from a single operator surface.

The future UI should help an operator:
- select a project and run,
- choose provider profiles per role,
- see worker and reviewer sessions,
- inspect stdout, stderr, last messages, reports, reviews, and events,
- follow safe next actions,
- keep reviewer `Decision: PASS` as the hard finalize boundary.

This should extend the existing flow:

```txt
plan -> isolate -> execute -> collect -> review -> finalize
```

The UI should not turn CEWP into an automatic merge, push, publish, tag, or release tool.

## Provider Profile

A provider profile is a named, local configuration that describes how CEWP should use a provider for a role or session. It is more specific than a provider id and less powerful than arbitrary command execution.

Suggested beta shape:

```json
{
  "id": "opencode-explicit-model",
  "provider": "opencode",
  "label": "OpenCode explicit-model profile",
  "command": "opencode",
  "args": ["run"],
  "model": "provider/model-name",
  "mode": "headless",
  "auth": {
    "readiness": "unknown",
    "lastCheckedAt": null,
    "message": "Binary checks do not verify provider credentials."
  },
  "binary": {
    "versionArgs": ["--version"],
    "version": null
  },
  "workingDirectory": {
    "strategy": "role-worktree",
    "passesDirectoryArg": true
  },
  "output": {
    "contract": "adapter-result/v1",
    "stdout": "captured",
    "stderr": "captured",
    "structured": "json-or-jsonl",
    "lastMessage": "provider-or-synthesized"
  },
  "safety": {
    "cewpGuardrailsRequired": true,
    "allowedFilesRequiredForWorkers": true,
    "reviewerPassRequiredForFinalize": true
  }
}
```

This shape is a design target, not a committed public config schema.

### Profile Fields

`id`
: Local stable profile name, suitable for UI selection and future config references.

`provider`
: Registry provider id such as `codex-exec`, `manual`, or experimental `opencode`.

`command`
: CLI command or resolved executable path. It must remain explicit when the adapter executes an external binary.

`model`
: Optional provider-specific model override. CEWP should not assume an external CLI's default model is configured or usable.

`auth.readiness`
: A status such as `not-required`, `unknown`, `missing`, `ready`, or `failed`. Binary/version probes should not be treated as auth readiness.

`binary`
: Version probe information from the existing adapter availability model.

`mode`
: One of `headless`, `interactive-terminal`, or `manual`.

`workingDirectory`
: How the provider receives the role work directory. Existing worker execution should continue to use isolated worktrees.

`output`
: How stdout, stderr, structured events, last-message content, and result normalization are expected to work.

`safety`
: The CEWP-owned boundaries that the profile cannot disable.

## Terminal Session

A terminal session is a future runtime projection for interactive provider processes. It is not the same as today's one-shot dispatch execution.

Suggested read model:

```json
{
  "sessionId": "session-01H...",
  "runId": "20260617-034723",
  "role": "worker-a",
  "providerProfileId": "opencode-local-gemini",
  "mode": "interactive-terminal",
  "state": "starting",
  "process": {
    "pid": null,
    "startedAt": null,
    "endedAt": null,
    "exitCode": null,
    "timedOut": false
  },
  "streams": {
    "stdout": "adapter-output/worker-a-stdout.log",
    "stderr": "adapter-output/worker-a-stderr.log"
  },
  "input": {
    "promptPath": "dispatch-prompts/worker-a.md",
    "lastUserInputAt": null
  },
  "artifacts": {
    "lastMessage": "adapter-output/worker-a-last-message.md",
    "report": "reports/worker-a-report.md"
  },
  "controls": {
    "canInterrupt": true,
    "canStop": true,
    "canSendInput": true
  }
}
```

This should start as a read-only projection before CEWP owns long-running terminal processes.

### Interactive Terminal Vs One-Shot Dispatch

One-shot dispatch:
- receives one prepared prompt,
- runs one process to completion,
- captures logs and result,
- returns `adapter-result/v1`,
- lets CEWP run post-checks.

Interactive terminal session:
- may stay open across multiple prompts,
- streams stdout and stderr over time,
- needs explicit interrupt and stop controls,
- needs a session lifecycle separate from role/task status,
- must still produce the same reports, last-message artifacts, timeline entries, and guardrail evidence before collect/review/finalize.

Manual mode:
- does not start a process,
- writes handoff files,
- uses result intake to record human output,
- can still appear in a terminal UI as a checklist or handoff panel.

## Future UI Layout Needs

The future operator UI should be built around existing read models before adding process orchestration.

Suggested layout:
- Project selector: current repo, detected CEWP setup, current policy mode.
- Run selector: `run list` data, latest marker, run state, modified time.
- Provider/model selector: provider profiles grouped by `headless`, `interactive-terminal`, and `manual`.
- Role grid: manager, worker-a, worker-b, reviewer state with assigned profile.
- Terminal grid: interactive sessions or read-only logs per role.
- Timeline panel: `operator-json/v1` timeline events, malformed event warnings, dispatch failures.
- Artifact inspector: typed artifact inventory with preview links for reports, reviews, last messages, logs, manual handoffs, review packets, run metadata, and board metadata.
- Reviewer gate panel: reviewer report, parsed decision, finalize dry-run status, and PASS requirement.
- Next action panel: `run next` recommendation and safe follow-up commands.

The first UI-compatible API surface should remain file-backed and local. The CLI JSON envelope is already the right starting point:

```txt
operator-json/v1
```

## Multi-Agent Orchestration

CEWP should orchestrate multiple agents by keeping role, task, and artifact ownership in CEWP rather than inside provider-specific tools.

The orchestrator should:
1. Create a run and task board.
2. Assign worker tasks with narrow `allowedFiles` and `forbiddenFiles`.
3. Create isolated worktrees.
4. Resolve a provider profile per role.
5. Generate dispatch prompts.
6. Execute workers as one-shot adapters, interactive terminal sessions, or manual handoffs.
7. Capture stdout, stderr, last messages, reports, and events.
8. Run post-execution scope checks.
9. Collect a review packet.
10. Execute reviewer or manual review.
11. Require reviewer `Decision: PASS` before finalize.
12. Produce a resume packet and next-step guidance.

Provider selection should be per role. For example:

```json
{
  "profiles": {
    "worker-a": "codex-default",
    "worker-b": "opencode-explicit-model",
    "reviewer": "manual-reviewer"
  }
}
```

This is a future shape only. Current `cewp.config.json` still resolves provider ids, not full profiles.

## Adapter Categories

Current categories:
- One-shot headless adapter: `codex-exec`.
- Non-executing adapter: `manual`.
- Experimental headless external CLI adapter: `opencode`.

Future categories:
- Interactive terminal adapter: CEWP starts or attaches to a long-running provider terminal and records a session read model.
- API/model adapter: CEWP calls an API or local model endpoint without a provider CLI.
- Hybrid adapter: CEWP uses a CLI for auth/session management but still normalizes output through `adapter-result/v1`.

Every category must keep CEWP-owned safety boundaries intact.

## What Not To Build Yet

Do not build yet:
- desktop UI implementation,
- WebSocket server,
- long-running terminal process manager,
- Claude Code, Gemini, Hermes, marketplace, or placeholder providers,
- agent marketplace or plugin catalog,
- automatic merge, push, publish, tag, or release,
- weaker guardrails for `allowedFiles`, `forbiddenFiles`, scope checks, or reviewer PASS.

The next phase should first make profiles explicit and observable through CLI/JSON before adding a UI runtime.

## Recommended Implementation Steps

1. Provider profile schema draft
   - Goal: add a small internal schema/read model for provider profiles.
   - Likely files: adapter config docs, registry/config helpers, harness tests.
   - Verification: config normalization tests and doctor output tests.

2. Model override support for experimental providers
   - Goal: let profiles carry provider-specific model args without depending on CLI defaults.
   - Likely files: OpenCode command contract, adapter config helpers, tests.
   - Verification: fake OpenCode command construction tests; no real OpenCode required.

3. Auth readiness separation
   - Goal: distinguish binary availability from provider auth/model/config readiness in profile output.
   - Likely files: adapter availability helpers, doctor output, docs.
   - Verification: doctor tests for binary-ready/auth-unknown states.

4. Operator JSON profile projection
   - Goal: expose selected provider/profile metadata in `operator-json/v1` without starting sessions.
   - Likely files: run inspection serialization, status/resume JSON tests.
   - Verification: `run status --json` and `run resume --json` envelope tests.

5. Terminal session read model
   - Goal: define session records and artifact links as read-only files before process control exists.
   - Likely files: new runtime projection helper, docs, tests.
   - Verification: snapshot tests for session inventory; no process spawning.

6. Optional UI prototype
   - Goal: validate layout and operator flow against static JSON fixtures.
   - Likely files: prototype-only docs or ignored prototype area.
   - Verification: fixture-driven UI smoke checks if a prototype is created.

7. Interactive process orchestration
   - Goal: only after the read model is stable, add controlled start/stop/interrupt behavior.
   - Likely files: future terminal session runtime, adapter contracts, safety tests.
   - Verification: fake terminal harness; no real provider dependency.

## Release Criteria For A Future Profile Phase

A future profile-focused beta should ship only when:
- provider profile data is visible in doctor or operator JSON,
- binary readiness and auth readiness are separate,
- model overrides are explicit and testable without real provider credentials,
- existing `codex-exec`, `manual`, and experimental `opencode` behavior remains compatible,
- package surface stays clean,
- docs still state that non-implemented providers are not supported,
- reviewer PASS, scope checks, and no automatic publish/tag/release boundaries remain unchanged.
