"use strict";

function usage() {
  console.log(`Codex Engineering Workflow Pack

Usage:
  cewp init [--mode repo|global] [--target <path>] [--force] [--with-config]
  cewp list [--mode repo|global] [--target <path>]
  cewp doctor [--mode repo|global] [--target <path>]
  cewp policy show
  cewp policy set <safe|trusted|full-authority>
  cewp policy reset
  cewp run init --workers <count> --reviewer
  cewp run status
  cewp run prompts
  cewp run prompt <manager|worker-a|worker-b|reviewer>
  cewp run worktrees plan
  cewp run worktrees create [--dry-run]
  cewp run worktrees status
  cewp run dispatch plan
  cewp run dispatch check
  cewp run dispatch prompts
  cewp run dispatch start --dry-run
  cewp run dispatch exec <role> --adapter codex-exec --dry-run
  cewp run dispatch exec <role> --adapter codex-exec --yes [--timeout <seconds>]
  cewp run dispatch exec workers --adapter codex-exec --yes [--timeout <seconds>]
  cewp run dispatch exec workers --adapter codex-exec --yes --parallel [--timeout <seconds>]
  cewp run dispatch pipeline --adapter codex-exec --yes [--timeout <seconds>]
  cewp run dispatch pipeline --adapter codex-exec --yes --parallel [--timeout <seconds>]
  cewp run collect
  cewp run finalize [--dry-run]
  cewp run cleanup [--yes]
  cewp run prune [--keep <count>] [--older-than <age>] [--yes]
  cewp --help

Defaults:
  repo mode defaults to the current working directory when --target is omitted
  run commands default to the current working directory and latest run unless --run <id> is provided

Examples:
  cewp init
  cewp init --mode repo
  cewp init --mode repo --with-config
  cewp init --mode repo --target "C:\\path\\to\\repo"
  cewp init --mode repo --target "/path/to/repo" --force
  cewp init --mode global
  cewp init --mode global --force
  cewp list
  cewp doctor --mode repo --target "/path/to/repo"
  cewp policy show
  cewp policy set trusted
  cewp policy set full-authority
  cewp policy reset
  cewp run init --workers 2 --reviewer
  cewp run status
  cewp run status --run 20260528-232250
  cewp run prompts
  cewp run prompt manager --run 20260528-232250
  cewp run worktrees plan --run 20260528-232250
  cewp run worktrees create --run 20260528-232250 --dry-run
  cewp run worktrees status --run 20260528-232250
  cewp run dispatch plan --run 20260528-232250
  cewp run dispatch check --run 20260528-232250
  cewp run dispatch prompts --run 20260528-232250
  cewp run dispatch start --run 20260528-232250 --dry-run
  cewp run dispatch exec worker-a --run 20260528-232250 --adapter codex-exec --dry-run
  cewp run dispatch exec worker-a --run 20260528-232250 --adapter codex-exec --yes --timeout 120
  cewp run dispatch exec workers --run 20260528-232250 --adapter codex-exec --yes --timeout 120
  cewp run dispatch exec workers --run 20260528-232250 --adapter codex-exec --dry-run --parallel
  cewp run dispatch exec workers --run 20260528-232250 --adapter codex-exec --yes --parallel --timeout 120
  cewp run dispatch exec reviewer --run 20260528-232250 --adapter codex-exec --yes --timeout 120
  cewp run dispatch pipeline --run 20260528-232250 --adapter codex-exec --yes --timeout 120
  cewp run dispatch pipeline --run 20260528-232250 --adapter codex-exec --yes --parallel --timeout 120
  cewp run dispatch pipeline --run 20260528-232250 --adapter codex-exec --dry-run
  cewp run dispatch pipeline --run 20260528-232250 --adapter codex-exec --dry-run --parallel
  cewp run collect --run 20260528-232250
  cewp run finalize --run 20260528-232250 --dry-run
  cewp run cleanup --run 20260528-232250
  cewp run prune --keep 5
  cewp run prune --keep 5 --yes
  cewp run prune --older-than 7d --yes
`);
}

module.exports = {
  usage,
};
