# Contract Extension Example

Use this checklist when extending a CEWP JSON contract. The example is
provider-neutral and keeps host identities in an integration record.

## Start With Observable Behavior

Add one focused contract test through a public Core function or CLI command. The
test should fail for the missing behavior and state the truth boundary it proves.

```json
{
  "schemaVersion": "example-evidence/v1",
  "evidenceId": "example-1",
  "availability": "unknown",
  "value": null,
  "reason": "the supported host boundary did not expose this field"
}
```

Do not add provider thread, account, model, or billing identifiers to a workflow
definition merely because one adapter exposes them. Store those references in a
versioned integration binding or observation.

## Validate And Fail Closed

- Use an explicit `schemaVersion` and bounded enums.
- Reject missing required fields, unsupported versions, unsafe paths, and
  contradictory claims.
- Preserve unknown instead of supplying a structural zero or guessed value.
- Keep imported observations separate from preventive enforcement.
- Require the same Core gates from CLI and MCP callers.

Malformed new data must fail closed. Historical data that can be read safely may
produce a partial projection with warnings; it must not be silently promoted.

## Compatibility And Migration

Define read compatibility before changing a writer. Preserve the prior schema in
fixtures, preview migrations, back up mutable state, and require explicit apply.
Never rewrite append-only historical evidence merely to make it look current.

Document the stability level, deprecation path, and downgrade warning. Add the
focused contract test to an independently runnable package script and to the
appropriate phase suite.

## Verification

Run the focused test first, then syntax, full contracts, smoke, package dry-run,
privacy tracking scan, and platform gates proportional to the change. Explain
exactly which requirement each result proves.
