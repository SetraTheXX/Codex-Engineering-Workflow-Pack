# Test Quality Guide

Good tests describe behavior that matters to users or callers.

## Prefer

- Public interfaces.
- Integration-style coverage when fast enough.
- Clear scenario names.
- Domain vocabulary.
- Deterministic setup.
- Assertions on observable outcomes.

## Avoid

- Private methods.
- Internal call counts.
- Over-mocking the behavior owner.
- Snapshot-only confidence for complex behavior.
- Tests coupled to file structure or helper names.
- Broad tests with vague failure messages.

## Test Naming

Use names that explain the behavior:

```txt
returns validation error for expired invite
creates invoice after successful checkout
keeps draft unchanged when publish fails
```

Avoid names that explain implementation:

```txt
calls helper with params
sets internal flag
uses service method
```

## Mock Decision Note

When using a mock or stub, record why:

```txt
Using a stub for email delivery because the test verifies checkout behavior, not the external email provider.
```
