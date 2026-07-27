# Codex Engineering Workflow Pack

[![CI](https://github.com/SetraTheXX/Codex-Engineering-Workflow-Pack/actions/workflows/ci.yml/badge.svg)](https://github.com/SetraTheXX/Codex-Engineering-Workflow-Pack/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@setrathex/codex-engineering-workflow-pack)](https://www.npmjs.com/package/@setrathex/codex-engineering-workflow-pack)
[![Node.js](https://img.shields.io/badge/Node.js-22%20%7C%2024%20%7C%2026-339933?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Controlled Codex execution for work that is too important to run blind.**

CEWP is an unofficial, local-first supervision and evidence layer for Codex. It
adds explicit scope, isolated worktrees, bounded retries, deterministic
verification, independent review, recovery controls, and portable receipts while
leaving code generation to Codex.

## Why CEWP

Native Codex is the right choice for small, low-risk work. CEWP is designed for
changes where an undetected scope violation, failed verification, uncontrolled
retry, or unverifiable result would be expensive.

| Need | CEWP control |
| --- | --- |
| Prevent accidental broad edits | Approved file scope and isolated worktree |
| Limit repeated model operations | Explicit operation, repair, and reviewer budgets |
| Recover without losing evidence | Pause, resume, revise, retry, and retained checkpoints |
| Verify outside the model loop | Deterministic local commands and scope inspection |
| Require a second decision | Independent reviewer PASS before finalization |
| Explain what happened | JSON and Markdown receipts with honest usage labels |

CEWP does not attach to private ChatGPT sessions, scrape interfaces, infer missing
usage, route automatically between models, or merge, push, publish, tag, or
release code.

## Quick Start

Requirements:

- Node.js 22 or newer
- Git 2.39 or newer
- Codex CLI for managed execution

Check the live npm tags, then install the current beta CLI:

```bash
npm view @setrathex/codex-engineering-workflow-pack dist-tags --json
npm install -g @setrathex/codex-engineering-workflow-pack@beta
cewp init
cewp doctor
```

To evaluate the exact GitHub candidate before or without a registry publication,
run it from a source checkout:

```bash
git clone https://github.com/SetraTheXX/Codex-Engineering-Workflow-Pack.git
cd Codex-Engineering-Workflow-Pack
node ./bin/cewp.js doctor
```

Run the credential-free walkthrough:

```bash
node ./bin/cewp.js demo supervised
```

Create a bounded checkpoint in a disposable or reviewed repository:

```bash
cewp supervise plan \
  --goal "Update the installation example" \
  --scope README.md \
  --verify "git diff --check" \
  --stop "The example is accurate and the approved check passes"
```

Inspect the proposal before enabling managed operations:

```bash
cewp policy set full-authority
cewp supervise approve <run-id> --yes
cewp supervise execute <run-id> --yes
cewp supervise verify <run-id>
cewp supervise review <run-id> --yes
cewp supervise receipt <run-id>
cewp supervise finalize <run-id> --yes
cewp policy reset
```

The advanced policy permits requested local operations; it does not disable
scope, budget, verification, ownership, or reviewer gates.

## Safety Model

CEWP Core is the authority for every completion claim:

1. The operator approves bounded scope and stopping conditions.
2. Managed execution uses the selected `codex-exec` backend in an isolated
   worktree.
3. CEWP checks changed paths and test-authoring policy.
4. Approved verification runs outside the model loop.
5. An independent reviewer must return PASS.
6. Receipt generation and explicit finalization close the run.

Unknown host usage remains `unknown`; it is never converted to zero or a
fabricated currency value. Budget or host exhaustion produces a resumable state,
not a false PASS.

## Operating Surfaces

- **CLI:** planning, execution, verification, recovery, review, receipts, and
  workflow operations.
- **Codex plugin:** three focused conversational skills.
- **Local MCP:** the same Core operations and gates exposed over stdio.
- **Evidence hooks:** optional, reviewable observations that never replace Core
  enforcement.

The stable managed path is `managed` + `codex-exec`. App Server remains
experimental and OpenCode remains optional and outside the golden path.

## Documentation

Start here:

- [Installation](docs/install.md)
- [Supervised workflow](docs/supervised-workflow.md)
- [Native Codex or CEWP?](docs/native-goal-or-cewp.md)
- [Architecture](docs/architecture.md)
- [Security model](docs/security-model.md)
- [Recovery guide](docs/recovery-guide.md)
- [Evidence receipts](docs/evidence-receipts.md)
- [Compatibility contract](docs/stable-compatibility.md)
- [Validation status](docs/validation-status.md)
- [Known limitations](docs/known-limitations.md)

Reference:

- [Workflow runtime](docs/workflow-runtime.md)
- [Contract index](docs/contracts.md)
- [Contract extension example](docs/contract-extension-example.md)
- [Adapter contract](docs/adapter-contract.md)
- [Operator policy](docs/operator-policy.md)
- [Migration policy](docs/migration-policy.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Development

The runtime has no package dependencies. From a source checkout:

```bash
node ./bin/cewp.js --help
node ./bin/cewp.js doctor
npm test
npm run check
npm run pack:dry-run
```

CI runs on Windows and Ubuntu with Node.js 22, 24, and 26.

## Project Status

CEWP is beta software. Stable-core compatibility, migration, recovery, security,
and package lifecycle contracts are implemented. The project is not published as
`1.0.0`; final release validation and explicit human-controlled publication
remain separate steps.

See [Validation Status](docs/validation-status.md) and
[Release Notes](docs/release-notes.md) for the current evidence boundary.

## License

[MIT](LICENSE)
