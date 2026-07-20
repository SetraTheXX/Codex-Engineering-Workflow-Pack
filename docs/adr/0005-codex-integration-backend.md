# ADR 0005: Codex Integration And Managed Backend

Status: accepted
Date: 2026-07-18

## Context

CEWP must keep `managed`, `native`, and `audit-only` execution ownership separate from the Codex interface used to present or observe a workflow. A plugin, skill, hook, MCP server, native goal, and App Server connection have different trust and lifecycle boundaries. Discovering a method in a generated App Server schema does not give an installed plugin access to the ChatGPT desktop app's current thread, goal, credentials, or private event stream.

The Phase 11 review used the current Codex manual and a controlled local probe against `codex-cli 0.137.0`. The probe used an isolated `CODEX_HOME`, copied no credentials, and started no model turn. Plugin install, disable, upgrade, and uninstall are separately covered by the credential-free plugin lifecycle capability test.

## Surface Comparison

| Surface | Ownership and lifecycle | Usage and limits | Warning and recovery | Stability | CEWP decision |
| --- | --- | --- | --- | --- | --- |
| ChatGPT desktop Codex and Goal mode | Host-owned `native`; the user can start, pause, resume, edit, and clear a goal | Not available to plugin code through a documented structured boundary | Conversation text is supported; native controls remain host-owned | Goal mode is documented, but plugin attachment to the existing internal session is not | Use the generated-goal and explicit-intake fallback until a versioned plugin-path capability test passes |
| Codex plugin | Packages skills, MCP configuration, hooks, apps, and assets; it is not an execution owner by itself | Installing a plugin does not grant account, goal, or session telemetry | Skills and MCP tools can return structured status; hooks require separate review and trust | Supported packaging and lifecycle on tested CLI | Primary install and discovery surface |
| Local MCP | Calls CEWP Core operations in the current repository; it does not own model execution | Can expose CEWP operational budgets and observed CEWP evidence, not hidden host usage | Structured tool errors and next actions preserve CLI gates | Documented local extension boundary | Selected integration bridge |
| Hooks | Host invokes opted-in handlers at documented lifecycle points | No complete per-run usage boundary | Can emit transient status or warnings; coverage is not complete enforcement | Supported but trust-sensitive | Optional evidence projection only; CEWP Core remains authoritative |
| `codex exec --json` | CEWP-owned `managed` child process per checkpoint | Reports managed turn usage in structured JSONL | CEWP owns process exit, cancellation attempt, artifacts, verification, and recovery | Existing stable CEWP backend | Retain as the managed backend through this decision |
| Codex App Server | Would be a separate CEWP-owned `managed` process with its own auth, threads, transport, and cleanup | Schema exposes useful lifecycle and some account/thread observations, but authenticated coverage and plugin delivery are not proved | Rich lifecycle methods exist; in-flight interruption remains best-effort | CLI labels the interface experimental | Do not graduate yet |
| Apps SDK or MCP App UI | Adds MCP-backed presentation and tools, not execution ownership | Receives only data explicitly returned by its MCP server | Can present richer cards but cannot inject CEWP into native goal chrome | Supported as a separate app surface | Progressive enhancement after the headless bridge |
| Agents SDK with Codex MCP server | A separate client can orchestrate a Codex MCP process | Usage belongs to that separately owned client boundary | Client owns cancellation and recovery | Separate integration path | Document for external clients; do not make it the plugin backend |

## Decision

1. Keep `managed`, `native`, and `audit-only` as the only execution owners.
2. Keep `codex-exec` as the selected managed backend. An explicit App Server request falls back to `codex-exec` while App Server is ungraduated.
3. An App Server backend may graduate only after a supported versioned capability proves at least one material lifecycle, usage, or recovery advantage plus process ownership, authentication-boundary, and cleanup behavior.
4. A CEWP-owned App Server must not attach to the ChatGPT desktop app's existing internal session.
5. Native Goal mode uses a generated-goal and explicit-intake fallback unless the installed plugin path itself passes a versioned goal lifecycle capability test.
6. Local MCP is the structured plugin and third-party bridge. MCP tools call CEWP Core services and preserve the CLI's approval, scope, budget, verification, and reviewer gates.
7. Hooks remain opt-in, reviewable, fail-safe evidence projections. Hook absence or failure never opens a Core gate.
8. Host observations stay `unknown` unless a documented, versioned boundary exposes them to the path actually making the claim. Account activity is not per-run usage, and host limits are not CEWP operational budgets.
9. Model and effort changes require operator approval. CEWP does not add automatic model routing through 1.0.

## Consequences

- Existing `codex-exec` users keep a stable fallback and one backend per managed checkpoint.
- Native goals remain useful without CEWP pretending to control or inspect a private host session.
- External agent interfaces can use MCP and `operator-json/v1` without CEWP building a competing terminal or desktop UI.
- Capability or schema drift produces an explicit compatibility warning and returns to generated-goal or explicit intake.
- App Server can be reconsidered later without changing CEWP's provider-neutral workflow and evidence schemas.

## Sources

- [Goal mode](https://learn.chatgpt.com/docs/goals)
- [Plugins](https://learn.chatgpt.com/docs/plugins)
- [Build plugins](https://learn.chatgpt.com/docs/build-plugins)
- [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp)
- [Hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Use Codex with the Agents SDK](https://learn.chatgpt.com/docs/mcp-server)
