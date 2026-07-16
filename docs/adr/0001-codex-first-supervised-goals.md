# ADR 0001: Codex-First Supervised Goals And Evidence

Status: accepted
Date: 2026-07-16

## Context

Codex already owns long-running model loops, threads, worktrees, and interactive task surfaces. CEWP has a useful local runtime for scoped worktrees, adapter dispatch, deterministic verification, artifact collection, timeline events, and a required reviewer PASS gate. Building another agent desktop or competing endless loop would duplicate the host while weakening CEWP's existing enforcement boundary.

## Decision

CEWP will be a Codex-first supervision, governance, and evidence layer.

- A thin ChatGPT/Codex plugin will provide installation and conversational entry points.
- The local CEWP Core runtime remains the source of truth for workflow state, budgets, policy, verification, evidence, and finalization.
- Native Codex goals remain the preferred path for simple, low-risk work.
- CEWP targets multi-step, risky, resumable, release-sensitive, or independently auditable work.
- Every run records exactly one execution owner: `managed`, `native`, or `audit-only`.
- Existing provider-neutral contracts remain readable, but Codex is the primary execution engine through 1.0.
- Experimental OpenCode receives compatibility, diagnostic, security, and critical bug maintenance only through 1.0.
- No Claude, Gemini, Hermes, or additional provider adapter is part of the 1.0 path.
- CEWP will not build a standalone desktop application, terminal server, or replacement conversation UI.
- Existing scope, policy, worktree-containment, and reviewer PASS gates remain non-waivable.

## Consequences

The first product path must prove one supervised Codex checkpoint end to end before broader workflow compilation or autonomy. Host integrations are accepted only through documented capability probes and fall back honestly when unavailable. Provider growth and custom UI work do not compete with reliability, recovery, and evidence work before 1.0.

CEWP must also show when native Codex alone is the better choice. Pilot evidence, rather than provider count or raw autonomy duration, determines whether later orchestration work is justified.
