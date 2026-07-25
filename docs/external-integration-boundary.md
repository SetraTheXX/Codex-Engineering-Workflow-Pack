# External Integration Boundary

CEWP is a local workflow, governance, verification, and evidence runtime. A third-party interface may
present CEWP state in its own agent UI, but it must not become the execution owner merely by calling a
CEWP control surface. It remains responsible for its UI, user consent, authentication, transport lifecycle,
and any agent process it starts.

## Supported Headless Surfaces

`operator-json/v1` is the stable envelope shape for CLI inspection and control results. External tools may
invoke documented `cewp ... --json` commands, retain the `command`, `generatedAt`, `data`, and `warnings`
fields, and render them without converting warnings or observations into PASS. In particular,
`cewp integration controls <workflow-run-id> --json` keeps preventive, post-execution, imported, and
unavailable controls distinct.

`cewp-mcp` is the structured local stdio bridge. Configure its current working directory as exactly one
intended repository. It exposes create, inspect, approve, continue, retry, revise, verify, and finalize; the
tools import the same CEWP Core services as the CLI. An MCP client may add its own confirmation UI, but
cannot bypass Core approval, ownership, policy, effort, scope, budget, verification, receipt, or reviewer
gates. The server opens no network listener and provides no host account, billing, or private-session data.
Unsupported MCP protocol versions return an explicit `mcp-protocol-version-drift` compatibility warning
and name `cewp-cli-operator-json` as the safe fallback.

Hooks and conversation messages are optional projections. Hook evidence is separately trusted and
version-bound; a missing, disabled, stale, or malformed hook never changes Core enforcement.

## Execution Ownership

The external UI is not a fourth owner. Each run remains `managed`, `native`, or `audit-only`. A managed
checkpoint retains one backend and one CEWP-owned worktree. Native work remains host-owned. Audit-only
evidence may be imported or checked after execution but never presented as preventive enforcement.
Provider-specific host, goal, thread, turn, and subagent identifiers stay in integration sidecars rather
than provider-neutral workflow schemas.

## Rich Codex Clients And App Server

A client that needs rich Codex thread, turn, or goal lifecycle should integrate with the documented Codex
App Server and own that separate process, authentication boundary, thread identifiers, selected working
directory, interruption behavior, and cleanup. That client is separate from the CEWP plugin. Its process
does not attach to the ChatGPT desktop app's existing internal session, inherit private desktop credentials,
or turn App Server schema presence into plugin capability.

CEWP has not graduated App Server as a managed backend. A request for that ungraduated backend falls back
to the selected `codex-exec` path, which already owns isolated dispatch, artifacts, verification, recovery,
and reviewer gates. External clients can still use CEWP MCP or operator JSON around their own UI without
changing this backend decision.

CEWP will build no custom terminal-session protocol, terminal server, desktop shell, private Codex
protocol adapter, UI scraper, or undocumented desktop-session attachment. A richer client should compose
the supported Codex App Server and CEWP's headless surfaces rather than making CEWP a competing terminal
product.
