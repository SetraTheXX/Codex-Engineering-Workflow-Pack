# Skill And Plugin Compatibility

Observed: 2026-07-16

CEWP's ten bundled skills use the current Codex skill shape: a required `SKILL.md` with `name` and `description`, plus optional `scripts/`, `references/`, `assets/`, and `agents/`. `agents/openai.yaml` is accepted as optional UI, invocation-policy, and dependency metadata. CEWP no longer treats these official components as forbidden.

`npm run test:skill-format` validates all bundled skills and a synthetic skill containing every optional component. The package remains dependency-free; the validator checks only stable required metadata and filesystem shape rather than pretending to be a full YAML implementation.

| Skill | SKILL.md | References | Scripts/assets/agents required |
| --- | --- | --- | --- |
| setup-codex-engineering-workflow | compatible | present | no |
| diagnose | compatible | present | no |
| tdd | compatible | present | no |
| grill-with-docs | compatible | present | no |
| to-prd | compatible | present | no |
| to-issues | compatible | present | no |
| handoff | compatible | present | no |
| zoom-out | compatible | present | no |
| prototype | compatible | present | no |
| improve-codebase-architecture | compatible | present | no |

The Phase 9 plugin follows the official boundary:

- `.codex-plugin/plugin.json` is the required manifest and the only file under `.codex-plugin/`.
- `skills/`, `hooks/`, `.mcp.json`, `.app.json`, and `assets/` live at the plugin root and use `./`-prefixed contained paths.
- Installing or enabling a plugin does not trust its bundled hooks. CEWP hooks remain optional until the user reviews and trusts the current definition.
- A repo marketplace lives at `.agents/plugins/marketplace.json`; npm remains the source of the CEWP Core CLI/runtime.
- MCP and Apps SDK components are optional projections. The plugin skeleton and golden path cannot depend on them until their versioned capability tests pass.

Sources: [Build skills](https://developers.openai.com/codex/skills), [Build plugins](https://developers.openai.com/codex/plugins/build), and [Codex hooks](https://developers.openai.com/codex/hooks).

## Runtime Support

CEWP targets supported even-numbered Node.js lines: Node 22 maintenance LTS, Node 24 active LTS, and Node 26 current at this decision date. Node 18 and 20 are end-of-life and are no longer claimed by the next beta. CI covers Windows and Linux on 22, 24, and 26.

The runtime has no package dependencies, so there is no dependency resolution graph to lock or audit. A lockfile will be added if dependencies are introduced; until then `npm audit` cannot provide meaningful package-dependency findings. Package contents are instead checked through the dry-run surface contract.

Node lifecycle source: [Node.js Release Working Group](https://github.com/nodejs/Release#release-schedule).
