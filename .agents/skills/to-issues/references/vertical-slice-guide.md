# Vertical Slice Guide

A vertical slice delivers a small complete behavior across the layers it needs.

## Good Slice

- User can submit a valid form and see the saved result.
- CLI accepts one new option and produces verified output.
- API rejects invalid payload with documented error.
- Import flow handles one new source format end to end.

## Weak Horizontal Slice

- Add database table only.
- Build UI only.
- Add tests only.
- Create service class only.
- Refactor folder structure only.

## Allowed Exceptions

Use a non-vertical issue only when it unblocks many slices and has its own verification:

- migration prerequisite,
- shared test harness,
- compatibility shim,
- explicit decision record,
- throwaway prototype.

Explain why the exception is not user-facing.

## Slice Size Test

Ask:

- Can this be verified alone?
- Does it reduce user or caller risk?
- Could it be implemented without rereading the whole roadmap?
- Does it avoid speculative future work?
