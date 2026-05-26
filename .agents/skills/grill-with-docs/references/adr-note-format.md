# ADR Note Format

Use this compact format when a decision deserves durable recording.

```md
# ADR: <decision title>

## Context

What forced the decision?

## Decision

What are we choosing?

## Alternatives

What else was considered?

## Consequences

What improves, what gets harder, and what should future agents know?

## Verification

How will we know the decision is working?
```

## Good ADR Signals

- Hard to reverse.
- Surprising without context.
- Real alternatives existed.
- Affects module boundaries, persistence, API contracts, or test strategy.

## Poor ADR Signals

- Temporary preference.
- Obvious implementation step.
- Decision already captured elsewhere.
- No future reader would need the reason.
