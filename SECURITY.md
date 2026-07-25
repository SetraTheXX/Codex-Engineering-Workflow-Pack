# Security Policy

CEWP is beta software. Security fixes for supported local Core, CLI, Codex plugin,
MCP, hook, evidence, and packaging surfaces are accepted throughout the beta.

## Private Reporting

Report a suspected vulnerability through a private GitHub security advisory:

https://github.com/SetraTheXX/Codex-Engineering-Workflow-Pack/security/advisories/new

Do not disclose exploit details, secrets, credentials, private paths, source code,
or unredacted logs in a public issue. If the private advisory form is unavailable,
open a public issue that asks the maintainer for a private contact path without
including vulnerability details.

Include the CEWP version, OS, Node/Git/Codex versions, affected public command,
expected boundary, and the smallest sanitized reproduction. Do not send account
data or authentication material.

## In-Scope Boundaries

Reports are especially useful for:

- path containment, traversal, and symlink escapes;
- unsafe command or argument construction;
- MCP schema, confirmation, or Core-gate bypasses;
- hook trust, bundle drift, and false enforcement claims;
- receipt and pilot-export redaction failures;
- worktree ownership, cleanup, or double-dispatch conflicts;
- imported evidence being presented as preventive enforcement;
- provider output parsing that mutates state after malformed or partial output;
- package inclusion of private runtime or planning files.

CEWP does not claim that local hashes are tamper-proof, that hooks intercept every
tool path, or that pattern redaction proves arbitrary prose has no secret. Reports
that demonstrate a mismatch between documented and actual trust boundaries are in
scope.

## Response And Disclosure

The maintainer will acknowledge a private report when available, reproduce it in
a safe local fixture, classify data-loss and guardrail impact, and coordinate a
fix and disclosure timeline with the reporter. Do not publish details before a
fix or explicit coordinated disclosure agreement.
