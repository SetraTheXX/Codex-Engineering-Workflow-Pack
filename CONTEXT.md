# Codex Engineering Workflow Pack Context

## Language

**Skill pack**

A local collection of Codex skills that encode repeatable engineering workflows.

**Workflow skill**

A single focused skill under `.agents/skills/<skill-name>/` that guides Codex through one engineering behavior.

**Local-first**

The default behavior of writing project artifacts to local markdown files instead of requiring GitHub, SaaS tools, or remote publishing.

**Vertical slice**

A small unit of work that delivers narrow end-to-end value and can be verified independently.

**Feedback loop**

A command, test, script, or manual check that gives a clear pass/fail signal for a behavior or bug.

**Domain language**

The shared project vocabulary that keeps skill outputs consistent and avoids overloaded terms.

**Handoff**

A concise local document that lets a later Codex session continue without rebuilding the full conversation context.

## Relationships

- A skill pack contains many workflow skills.
- A workflow skill may reference one-level-deep files under `references/`.
- A PRD can be split into local markdown issues.
- A local issue should describe one vertical slice.
- Diagnose and TDD workflows depend on reliable feedback loops.
- Handoff documents reference existing artifacts instead of duplicating them.

## Avoid

- Calling the pack production-ready before pilots complete.
- Treating GitHub publish as required.
- Adding Agent Brief/model-to-model workflow to v0.1.
- Adding review, triage, setup-pre-commit, write-a-skill, or caveman to v0.1.
