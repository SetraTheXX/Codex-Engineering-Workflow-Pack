# 1.0 Security Review

Status: technical review complete for the candidate surface and Phase 13 maintainer
technical acceptance is complete. Exact final-source release matrices and an
explicit release decision remain. The release gate is zero open P0/P1 security or
data-loss issues. This document does not assert the state of unreported external bugs.

Reviewed boundaries:

- path containment rejects traversal and validates export/worktree roots;
- command construction uses argv arrays and explicit execution ownership;
- hook trust is opt-in, version-bound, reviewable, and fail-safe on drift;
- MCP tools call Core services and preserve approval, verification, and reviewer gates;
- artifact redaction is explicit, separate from canonical evidence, and not proof of secrecy;
- symlink and junction behavior fails closed at writable/export boundaries;
- worktree ownership and cleanup cannot overlap native and managed mutation;
- imported evidence remains audit-only and cannot manufacture enforced control;
- provider output parsing treats malformed, stale, and unavailable usage as unknown.

Residual risks are documented in `security-model.md` and `known-limitations.md`.
Release preparation performs no push, publication, tag, or GitHub release action.
