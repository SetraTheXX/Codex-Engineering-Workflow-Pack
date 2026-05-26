# Diagnosis Loop

Use this checklist for every bug or regression.

## Required Order

1. Reproduce
2. Minimize
3. Hypothesize
4. Instrument
5. Fix
6. Regression test
7. Cleanup
8. Verification summary

## Do Not Skip

- Do not fix before proving the symptom.
- Do not rely on code reading alone.
- Do not keep untagged temporary logs.
- Do not accept a test that fails for the wrong reason.
- Do not claim done without re-running the original repro.

## Final Summary Shape

```md
## Diagnosis Summary

Symptom:
Root cause:
Fix:
Regression coverage:
Verification:
Temporary instrumentation removed:
Remaining risk:
```
