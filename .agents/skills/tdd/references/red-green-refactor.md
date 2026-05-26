# Red Green Refactor

Use this loop for each behavior.

## Red

- Pick one behavior.
- Write one test.
- Run focused command.
- Confirm failure is expected.

## Green

- Implement only enough code to pass.
- Run focused command.
- Confirm the new test passes.

## Refactor

- Clean duplication and names.
- Keep public behavior unchanged.
- Run focused command again.

## Repeat

Move to the next acceptance criterion only after green.

## Stop Conditions

Stop and ask when:

- Public behavior is unclear.
- Acceptance criteria conflict.
- A new dependency or test framework would be required.
- The next slice is larger than the agreed scope.
