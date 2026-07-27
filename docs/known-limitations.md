# Known Limitations

CEWP is beta software. These limits are product boundaries, not hidden roadmap promises.

- The managed supervised convenience path supports one active checkpoint at a time. The workflow runtime supports validated DAGs, scheduling, revisions, and migrations, but its compiler emits a source-bound agent request rather than invoking a model or making arbitrary prose executable.
- Managed supervised execution uses exactly one owner/backend pair: `managed` with `codex-exec`.
- CEWP does not attach to a ChatGPT desktop task's private thread or native goal lifecycle.
- CEWP does not inject persistent desktop UI, a title-bar meter, or arbitrary notifications. Structured conversation and CLI output are the minimum warning surface.
- In-flight model/process interruption is best effort. A hard CEWP budget prevents the next controlled operation; it cannot promise an exact mid-turn token stop.
- ChatGPT subscription credit impact and host-internal retries or compaction remain `unknown` without a supported machine-readable contract.
- Numeric usage estimates stay unavailable until enough comparable local runs exist. When available, they are ranges with confidence and sample basis, never point promises.
- File-level test-authoring enforcement recognizes common test directories and filename conventions. It cannot prove whether production code contains test-like logic.
- The plugin contributes skills, a local stdio MCP bridge, and an optional review-required `SubagentStart`/`SubagentStop` evidence hook. The hook cannot expose a subagent thread id, does not read transcripts, and is never a Core enforcement boundary. MCP exposes only CEWP Core operations and does not attach to native host sessions. An Apps SDK card and App Server client are not shipped.
- Audit-only integration can validate imported evidence and record post-execution checks, but it cannot claim that CEWP prevented actions performed by the external owner. Its integration control receipt therefore permits no preventive entries.
- Experimental OpenCode execution remains optional and outside the supervised golden path. Binary/version availability does not prove authentication or model readiness.
- Manual is a non-executing handoff adapter. Claude, Gemini, Hermes, and other providers are not implemented.
- Supervised worktree cleanup automation is not shipped; rollback is available for owned unverified work, and terminal evidence is retained for deliberate inspection/removal.
- CEWP never automatically merges, pushes, publishes, tags, or creates a release.
- The stable-core candidate publishes explicit schema and migration contracts, but the package remains beta until exact final-source release validation and an explicit release decision are completed.
- Maintainer technical acceptance is complete. Independent user validation was not performed, so CEWP does not claim independent adoption, repeat-user evidence, or external case-study validation.

Report setup failures, workflow failures, or misleading evidence through the repository issue tracker. Include `cewp doctor --json` output after removing local paths or sensitive values.
