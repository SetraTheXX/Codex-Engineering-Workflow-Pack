# Refactor Sequencing Guide

Prefer small, reversible steps.

## Safe Order

1. Map current behavior.
2. Add or identify characterization tests.
3. Rename only when domain language is clear.
4. Introduce or narrow one interface.
5. Move one rule or behavior behind it.
6. Run focused verification.
7. Remove obsolete pass-through code.
8. Repeat.

## Split Into Issues When

- More than one module group is involved.
- Tests must be added first.
- A decision needs approval.
- A prototype would reduce uncertainty.
- Verification requires multiple commands.

## Avoid

- "Rewrite module X" as one task.
- Refactor before behavior is covered.
- Combining naming, behavior, and dependency changes in one step.
- Moving code without a verification command.
