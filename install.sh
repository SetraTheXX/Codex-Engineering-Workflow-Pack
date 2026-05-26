#!/usr/bin/env bash
set -euo pipefail

mode=""
target=""
force="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      mode="${2:-}"
      shift 2
      ;;
    --target)
      target="${2:-}"
      shift 2
      ;;
    --force)
      force="true"
      shift
      ;;
    -h|--help)
      echo "Usage: ./install.sh --mode repo|global [--target /path/to/repo] [--force]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$mode" != "repo" && "$mode" != "global" ]]; then
  echo "Error: --mode must be repo or global." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_root="$script_dir/.agents/skills"

if [[ ! -d "$source_root" ]]; then
  echo "Error: source skills folder not found: $source_root" >&2
  exit 1
fi

if [[ "$mode" == "repo" ]]; then
  if [[ -z "$target" ]]; then
    echo "Error: repo mode requires --target." >&2
    exit 1
  fi
  if [[ ! -d "$target" ]]; then
    echo "Error: target repo path does not exist: $target" >&2
    exit 1
  fi
  target_root="$target/.agents/skills"
else
  target_root="$HOME/.agents/skills"
fi

skills=(
  "setup-codex-engineering-workflow"
  "diagnose"
  "tdd"
  "grill-with-docs"
  "to-prd"
  "to-issues"
  "handoff"
  "zoom-out"
  "prototype"
  "improve-codebase-architecture"
)

mkdir -p "$target_root"

echo "Installing Codex Engineering Workflow Pack v0.1"
echo "Mode: $mode"
echo "Source: $source_root"
echo "Target: $target_root"

copied=()
skipped=()

for skill in "${skills[@]}"; do
  source_skill="$source_root/$skill"
  target_skill="$target_root/$skill"

  if [[ ! -d "$source_skill" ]]; then
    echo "Warning: missing source skill: $skill" >&2
    continue
  fi

  if [[ -e "$target_skill" && "$force" != "true" ]]; then
    echo "Warning: skipping existing skill without --force: $skill" >&2
    skipped+=("$skill")
    continue
  fi

  mkdir -p "$target_skill"
  cp -R "$source_skill"/. "$target_skill"/
  copied+=("$skill")
  echo "Copied: $skill"
done

echo ""
echo "Copied skills:"
if [[ ${#copied[@]} -eq 0 ]]; then
  echo "- none"
else
  for skill in "${copied[@]}"; do
    echo "- $skill"
  done
fi

if [[ ${#skipped[@]} -gt 0 ]]; then
  echo ""
  echo "Skipped existing skills:"
  for skill in "${skipped[@]}"; do
    echo "- $skill"
  done
fi

echo ""
echo "Restart or reload Codex so it can discover installed skills."
