# Grilling Question Patterns

Use questions that resolve decisions, not questions that ask the user to repeat repo facts.

## Product Behavior

- What should happen when this succeeds?
- What should happen when this fails?
- Which user or actor observes the outcome?
- Which edge case should be explicitly out of scope?

## Domain Language

- Is this term the same as an existing domain term?
- Is this a new concept or a subtype of an existing concept?
- Does the business use a different name than the code?

## Trade-Offs

- Is speed, correctness, simplicity, or reversibility most important here?
- Should this be temporary, experimental, or production behavior?
- What should be optimized now, and what can wait?

## Verification

- What behavior would prove this is done?
- Which command or workflow should catch regressions?
- Is manual verification acceptable for the first slice?
