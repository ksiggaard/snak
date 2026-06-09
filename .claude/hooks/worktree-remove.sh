#!/usr/bin/env bash
# WorktreeRemove hook — tears down a worktree created by worktree-create.sh.
# Fire-and-forget: always exits 0 so session cleanup is never blocked.
#
# stdin : JSON with .worktree_path .worktree_name .cwd
set -euo pipefail

input="$(cat)"
field() { printf '%s' "$input" | jq -r "$1 // empty"; }

wt_path="$(field '.worktree_path')"
repo="$(field '.cwd')"

[ -n "$repo" ] && cd "$repo" 2>/dev/null || true

if [ -n "$wt_path" ]; then
  git worktree remove "$wt_path" --force >&2 2>/dev/null || true
fi
git worktree prune >&2 2>/dev/null || true

exit 0
