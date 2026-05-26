# Handoff Settings

Handoff directory:

```txt
docs/agents/handoff/
```

Handoff files should be concise and local-first. They should reference existing PRDs, issues, validation reports, and skill files by path instead of duplicating their contents.

Required sections:

- Current Goal
- What Changed
- Decisions Made
- Verification
- Open Questions
- Risks
- Continue From Here
- Useful Paths

Redaction rule:

```txt
Do not include secrets, tokens, API keys, credentials, or private personal data.
```

Remote publish rule:

```txt
Do not publish handoffs remotely by default.
```
