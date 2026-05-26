# Deep Module Guide

A deep module gives callers a small interface with useful behavior behind it.

## Signals Of Shallow Modules

- Module mostly passes data through.
- Callers still know internal ordering rules.
- Many helpers must be imported together.
- Tests need private setup.
- Small interface change forces many unrelated edits.
- Deleting the module would not move complexity anywhere meaningful.

## Signals Of Deep Module Opportunities

- Repeated business rules across callers.
- Invariants scattered across files.
- Error handling duplicated.
- Domain concept lacks a single owner.
- Public API can become smaller while behavior stays rich.

## Good Recommendation Shape

```md
Candidate:
Files/modules:
Current friction:
Smaller interface:
Behavior hidden behind it:
Verification:
Risk:
First step:
```

## Rule

Prefer one useful deepening step over a broad rewrite.
