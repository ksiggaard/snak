#!/usr/bin/env bash
# WorktreeCreate hook — fallback used by Claude Code agent worktree isolation
# (Agent isolation:"worktree", EnterWorktree, --worktree) when its built-in git
# detector wrongly reports "not in a git repository". Just runs plain
# `git worktree add` and reports the path back to the harness.
#
# stdin  : JSON with .worktree_path .source_ref .target_ref .worktree_name .cwd
# stdout : the created worktree's absolute path (and the same path as JSON
#          hookSpecificOutput.worktreePath, for harness versions that expect it)
# exit 0 : success — any non-zero aborts worktree creation.
set -euo pipefail

input="$(cat)"
field() { printf '%s' "$input" | jq -r "$1 // empty"; }

wt_path="$(field '.worktree_path')"
src_ref="$(field '.source_ref')"
tgt_ref="$(field '.target_ref')"
[ -n "$tgt_ref" ] || tgt_ref="$(field '.worktree_name')"
repo="$(field '.cwd')"

if [ -z "$wt_path" ]; then
  echo "worktree-create: missing worktree_path on stdin" >&2
  exit 1
fi

[ -n "$repo" ] && cd "$repo"

# Reserve stdout for the result path — send all git chatter to stderr.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "worktree-create: $(pwd) is not a git repository" >&2
  exit 1
fi

# Idempotent: if a worktree already lives at this path, just report it.
if git worktree list --porcelain | grep -qxF "worktree $wt_path"; then
  :
else
  mkdir -p "$(dirname "$wt_path")" >&2
  if [ -n "$tgt_ref" ] && git show-ref --verify --quiet "refs/heads/$tgt_ref"; then
    # Branch already exists — attach to it rather than re-creating.
    git worktree add "$wt_path" "$tgt_ref" >&2
  elif [ -n "$tgt_ref" ]; then
    git worktree add "$wt_path" -b "$tgt_ref" ${src_ref:+"$src_ref"} >&2
  else
    git worktree add "$wt_path" ${src_ref:+"$src_ref"} >&2
  fi
fi

printf '%s\n' "$wt_path"
printf '{"hookSpecificOutput":{"hookEventName":"WorktreeCreate","worktreePath":"%s"}}\n' "$wt_path" >&2
exit 0
