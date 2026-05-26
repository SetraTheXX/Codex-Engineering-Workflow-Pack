# PRD Quality Checklist

Use before writing or presenting a PRD.

## Product Clarity

- Problem is written from the user's perspective.
- Goals are positive outcomes.
- Non-goals prevent scope creep.
- User stories name concrete actors.

## Engineering Clarity

- Technical approach is high-level and durable.
- No brittle file-by-file plan unless necessary.
- Relevant domain terms match `CONTEXT.md` or documented language.
- ADR constraints are acknowledged.

## Testability

- Acceptance criteria are observable.
- Verification notes mention commands or manual checks.
- Release gate is concrete.

## Risk Control

- Known unknowns are explicit.
- Migration, data, security, performance, or compatibility risks are listed when relevant.
- Follow-up skill is clear: `to-issues`, `prototype`, or `tdd`.
