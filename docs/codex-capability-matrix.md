# Codex Capability Matrix

Status: accepted Phase 11 decision
Observed: 2026-07-18

## Purpose

This matrix separates three boundaries that must not be conflated:

1. The ChatGPT desktop Codex task and tools exposed to its agent.
2. An installed Codex plugin, which can bundle skills, hooks, apps, and MCP configuration.
3. A separately started CEWP-owned Codex App Server process.

Schema presence does not prove that a plugin can attach to the desktop app's existing thread, goal, authentication state, or event stream. A CEWP-owned App Server is a `managed` backend, not a fourth execution owner.

## Status Labels

- `supported`: reproduced through a documented interface on the stated version.
- `experimental`: reproduced, but the command or contract is explicitly experimental.
- `host-specific`: observed in this ChatGPT/Codex host and not treated as portable.
- `unavailable`: the tested boundary rejected the operation or documentation excludes it.
- `unknown`: not enough supported evidence exists to claim readiness.

## Environment

- Host: ChatGPT desktop, Codex task, Windows.
- Host build identifier: unavailable through a documented agent API.
- Codex CLI: `codex-cli 0.137.0`.
- Node.js: `24.6.0`.
- App Server transport: local stdio.
- App Server auth boundary: isolated temporary `CODEX_HOME` with no copied credentials.
- App Server execution owner: `managed`.
- Model turns in the App Server lifecycle probe: zero.

## Host And Plugin Boundary

| Capability | Result | Evidence and limit |
| --- | --- | --- |
| Structured conversation warning | supported | The current task can render explicit checkpoint, budget, and blocked-state text. This is the minimum presentation path. |
| Plugin discovery and CLI management | supported | `codex plugin list` and marketplace commands are present in CLI 0.137.0. |
| CEWP plugin install and invocation | supported | The credential-free capability test covers plugin install, disable, upgrade, and uninstall in an isolated `CODEX_HOME`. A user must still install the plugin on each supported host surface. |
| Plugin access to the existing desktop thread | unavailable | No documented plugin API attaches arbitrary plugin code to the host-owned internal session or event stream. |
| Goal tools in the current task | host-specific | The agent can call host-provided goal tools and observe goal fields. This does not grant direct access to plugin code. |
| Plugin direct goal lifecycle control | unavailable | App Server goal methods belong to a separately connected App Server client; schema presence is not plugin access. |
| Apps SDK or MCP Apps card | unknown | Embedded ChatGPT UI is documented, but CEWP does not yet ship an app UI. It remains progressive enhancement rather than an enforcement dependency. |
| Persistent sidebar, title-bar meter, or goal-panel injection | unavailable | No documented extension point was found. CEWP will not patch or automate native chrome. |
| Desktop notifications | host-specific | The host owns documented notification behavior and settings. CEWP has no arbitrary notification category. |
| Hook `statusMessage` | supported | Official hook configuration exposes it as transient handler status. |
| Hook `systemMessage` | supported | Official hook output exposes it as a UI or event-stream warning. |
| `PreToolUse` deny output | supported | The deterministic fixture emits the documented `permissionDecision: deny` shape and is covered by `npm run test:hook-output`. |
| `PreToolUse` as complete enforcement | unavailable | Official docs exclude or limit richer shell and non-MCP paths. A real CLI 0.137.0 Windows probe executed the requested PowerShell command despite the Bash deny hook. Core policy remains authoritative. |
| Hook-based instant turn cancellation | unknown | Stop semantics do not establish instantaneous cancellation of an in-flight model or external process. |
| Local MCP to CEWP Core | unknown | MCP is supported by the host. Phase 11 implements a small Core-backed tool surface while conversation and CLI fallbacks remain required. |

## App Server Boundary

The reproducible probe is `npm run probe:codex-app-server`. It starts its own server and state directory and does not connect to the ChatGPT app's running internal client.

| Capability | Result | Evidence and limit |
| --- | --- | --- |
| Start and initialize stdio App Server | experimental | CLI 0.137.0 starts, completes the documented handshake, and labels App Server tooling experimental. |
| Start persisted thread | experimental | Passed in an isolated state directory without a model turn. |
| Resume persisted thread after server restart | experimental | Passed with the recorded thread id in the same isolated state directory. |
| Goal set/get/clear | experimental | Passed and emitted goal notifications. |
| Goal token budget round trip | experimental | `tokenBudget: 1000` round-tripped through set/get. This proves metadata, not automatic enforcement. |
| Goal pause status round trip | experimental | `paused` round-tripped through set/get. It does not prove automatic safe-checkpoint pausing. |
| Exact goal status enum | experimental | Generated 0.137.0 schema includes `active`, `paused`, `blocked`, `usageLimited`, `budgetLimited`, and `complete`. These are version-probed, not timeless constants. |
| Per-thread token usage event | unknown | Schema and current docs include `thread/tokenUsage/updated`; no model turn was started in the lifecycle probe. |
| Account read without credentials | supported | The isolated server returned an unauthenticated account result without exposing account data. |
| Account rate-limit read | unknown | Current docs and 0.137.0 schema expose the method, but the isolated auth boundary correctly rejected the live read. |
| Account usage summary | unavailable on tested schema | Current docs expose `account/usage/read`; generated 0.137.0 schemas do not. The authless runtime rejection cannot establish support behind the auth gate. |
| Turn interruption | unknown | No model turn was started. Any future cancellation claim remains best-effort until measured. |
| Worktree isolation | supported for selected `cwd` | Thread creation accepted an explicit isolated working directory. Same-worktree host/child ownership remains prohibited by CEWP policy. |
| Attach to existing ChatGPT desktop session | unavailable | The probe owns a separate process and does not inherit the desktop app's thread id or event subscription. |

## Nested Dispatch And Usage

A single real `codex exec --json` probe was run from the ChatGPT Codex task against a separate read-only temporary repository.

- The first attempt failed before work because CLI 0.137.0 could not run the desktop-selected `gpt-5.6-terra` model. CLI/model compatibility is therefore a readiness dimension separate from binary and auth readiness.
- An explicit `gpt-5.4` attempt completed and reported `turn.completed.usage`.
- Observed input tokens: 40,246.
- Observed cached input tokens: 22,272.
- Observed output tokens: 191.
- Observed reasoning output tokens: 74.
- The requested command executed through a path the Bash hook did not intercept.
- The child used a separate temporary repository and read-only sandbox. It did not share CEWP's active worktree.

This one observation is accounting evidence, not a cost estimate. It also demonstrates why capability probes that require model turns must not run in normal CI.

## Phase 11 Decision

CEWP retains exactly one supported managed execution pair:

- execution owner: `managed`
- backend: `codex-exec`
- default adapter: `codex-exec`

Reasons:

- The existing path already has scope, worktree, artifact, failure, and reviewer-gate coverage.
- App Server adds useful goal metadata and lifecycle methods, but remains a separately owned experimental process with version drift and unresolved authenticated usage/cancellation behavior.
- The spike did not demonstrate enough recovery or accounting advantage to justify shipping two incomplete managed backends.

The native fallback is a bounded generated goal brief plus supported host goal tools or explicit result intake. `audit-only` remains available for evidence supplied by another owner. The local MCP bridge is the next supported integration surface. Hooks and Apps SDK UI remain optional projections; their absence never weakens CEWP Core. See [ADR 0005](adr/0005-codex-integration-backend.md).

## Reproduction

```bash
codex --version
codex features list
codex app-server generate-json-schema --out <stable-output>
codex app-server generate-json-schema --experimental --out <experimental-output>
npm run probe:codex-app-server
npm run test:plugin-lifecycle
npm run test:hook-output
npm run test:integration-capabilities
```

The nested model probe is intentionally excluded from automated tests because it consumes account usage. Raw account values, credentials, thread ids, and machine-specific paths are not part of this document.

## Official Sources

- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Build Codex plugins](https://developers.openai.com/codex/plugins/build)
- [MCP Apps compatibility in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)
- [Codex changelog](https://developers.openai.com/codex/changelog)
