# Local Docs Layout

Default local-first layout:

```txt
docs/agents/
  issue-tracker.md
  domain.md
  test-commands.md
  handoff.md
  issues/
  handoffs/
docs/adr/
CONTEXT.md
```

## issue-tracker.md

Purpose: tell planning skills where issues live.

Minimum fields:

- Default tracker: local markdown
- Local issue directory: `docs/agents/issues/`
- Remote tracker: optional or none
- Remote publishing rule: only with explicit user request

## domain.md

Purpose: tell skills where domain language and decisions live.

Minimum fields:

- Domain language file: `CONTEXT.md`
- ADR directory: `docs/adr/`
- Multi-context notes if the repo has more than one domain area

## test-commands.md

Purpose: give `diagnose` and `tdd` reliable commands.

Minimum fields:

- Package manager
- Unit test command
- Focused test command pattern
- Typecheck command
- Lint command
- E2E command if present
- Unknowns

## handoff.md

Purpose: tell `handoff` where durable session summaries go.

Minimum fields:

- Handoff directory: `docs/agents/handoffs/`
- Required sections: current goal, completed work, open decisions, verification, next steps
- Redaction rule: no secrets or personal data
