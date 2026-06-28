# T16 — Token usage tracking

- **Status:** done (Wave2-T16, 2026-06-09 — usage captured per-provider in the
  streaming SSE loop, persisted to a v3 `usage` table, surfaced in a sortable
  by-model table + GitHub-style activity heatmap.)
- **Owner:** Wave2-T16
- **Priority:** P2
- **Layer:** Rust (capture usage) + DB (migration) + Frontend (charts)
- **Depends on:** —

(README idea 9.) Record and visualize token usage across models over time: input, output,
and cache tokens, with a table and a GitHub-style activity heatmap.

**Acceptance criteria:**
- Capture per-response usage (input/output/cache tokens + model + provider) from each
  provider's API response in `src-tauri/src/providers/` and persist it (new table via a
  numbered migration in `src-tauri/migrations/`).
- A usage view: a sortable table (by model/date) and a GitHub-style colored-squares
  calendar heatmap of activity.
- Usage is attributed to the right model even when a thread's model changes.

**Notes:**
- Provider usage fields differ (Anthropic reports cache-read/-write tokens separately) —
  consult the `claude-api` skill for the usage object shape. Streaming responses report
  usage in specific SSE events; capture from the existing SSE loop.
