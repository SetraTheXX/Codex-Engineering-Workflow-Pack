# Test Commands

Package manager:

```txt
None detected.
```

Primary validation commands:

```powershell
rg --files --hidden
```

Manual validation checklist:

- Confirm every skill lives under `.agents/skills/<skill-name>/SKILL.md`.
- Confirm frontmatter contains only `name` and `description`.
- Confirm `name` matches folder name.
- Confirm each `SKILL.md` has 100-200 lines.
- Confirm each `SKILL.md` has a `## Verification` section.
- Confirm no Claude-specific terms, Agent Brief/model-to-model terms, or forced GitHub publish language.
- Confirm no `scripts/`, `assets/`, or `agents/openai.yaml` files exist.

Unknowns:

- No automated test suite exists yet.
- No package manager script exists yet.
- No lint or typecheck command exists yet.
