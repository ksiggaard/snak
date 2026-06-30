> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Deep research mode (parallel research subagents)

**Date:** 2026-06-15
**Status:** Implemented (T55)
**Builds on:** `2026-06-09-mcp-support-design.md` (T13, the tool-call loop + built-in web server), T52 (web search)

## Problem

snak can already use tools (the built-in web browser + search) via a sequential tool-call
loop in `chat_stream`. But a genuinely involved research question — "compare the trade-offs
of X, Y, and Z, with current pricing and community sentiment" — is poorly served by one
model working one tool call at a time in a single context:

1. **No parallelism** — independent angles (X vs Y vs Z) are investigated one after another.
2. **Context pollution** — every raw search result and fetched page lands in the one
   conversation, crowding out the model's working memory and inflating cost.
3. **No decomposition** — the model can't hand off a focused sub-question to a worker that
   reports back only the conclusion.

Idea #26 asks for a mode the user activates in a chat that lets the model "spend more time
investigating", dispatching multiple simultaneous subagents (and sometimes sequential ones,
when it needs answer A before knowing to ask B), each operating in its own context and
returning only the relevant information, with the UI showing the subagents' progress.

## Goal

An **orchestrator-worker** mode, toggled per thread: the orchestrator (the thread's model)
can dispatch research **subagents** that each run their own bounded tool-loop in a fresh,
focused context with the web tools, and return a concise summary. Subagents run concurrently;
the orchestrator synthesizes their summaries. Sequential dependencies fall out naturally —
the orchestrator dispatches again on a later round once it sees the first batch.

**Invariant:** with the toggle off, behavior is byte-identical to today (no dispatch tool on
the wire, no extra system prompt).

Non-goals for v1: per-subagent nested tool-activity/source panels in the UI card; a
configurable (cheaper) subagent model. See Deferred.

## Decisions

- **Mechanism: a built-in `research__dispatch` tool**, not a separate command or a new
  provider method. The orchestrator calls it with an array of subtasks; each spawns a
  subagent. This reuses the entire existing provider/tool/approval/cancellation machinery via
  one shared loop, instead of duplicating it.
- **Reuse the loop:** extract `chat_stream`'s tool-call loop into a free `run_agent_loop`;
  both the orchestrator and every subagent run it. Subagents differ only in their tool list
  (web tools, **no** dispatch tool), a focused system prompt, a lower round cap, and no
  approval gate.
- **Depth bounded to 1:** subagents run with `allow_dispatch = false` and never receive the
  dispatch tool, so they cannot recurse. A hallucinated `research__dispatch` from a subagent
  falls through to MCP and returns a clean "no such server" error.
- **Per-thread, persisted toggle** (like favorite/archived): a `threads.deep_research` column,
  mirrored by a draft flag for unsaved chats.
- **Subagents inherit the thread's provider/model/key** (simplest; cost noted below).
- **Subagent internals are not streamed to the UI.** Only the lifecycle (dispatched → running
  → done/failed, with task + summary) reaches the chat, via a new `StreamDelta.subagent`
  event. The subagent's own provider/tool deltas go to a throwaway sink `Channel`, so the
  chat stays readable and the orchestrator's context clean.

## Architecture

```
chat_stream ── run_agent_loop (orchestrator, allow_dispatch=true, approvals=Some)
                  │  model calls research__dispatch
                  ▼
               run_subagents ── parse_subtasks
                  │  buffer_unordered(4)
                  ├── run_agent_loop (subagent 0, web tools, allow_dispatch=false) ─┐
                  ├── run_agent_loop (subagent 1, …)                                │ summaries
                  └── run_agent_loop (subagent N, …)                                │
                  ▼                                                                 │
               aggregate_summaries  ◀──────────────────────────────────────────────┘
                  │  one compact tool-result string + summed Usage
                  ▼
               (orchestrator's next round synthesizes)
```

### Backend (`src-tauri/`)

- **`commands/chat.rs`** — `run_agent_loop(client, provider, model, api_key, history, tools,
  servers, sessions, thread_id, on_delta, cancel, approvals: Option<&PendingApprovals>,
  max_rounds, allow_dispatch)`. The body is the former inline loop. A `research__dispatch`
  call (when `allow_dispatch`) is intercepted and handled by `run_subagents`; everything else
  routes to `mcp::call_tool` as before. The approval block is guarded by `Some(approvals)`.
  `chat_stream` gained `deepResearch: Option<bool>`; when true and web tools exist it appends
  `research::dispatch_tool_def()` and prepends the research system prompt (`with_system_prompt`).
- **`run_subagents`** — parses subtasks, emits `dispatched` for each, then runs them through
  `futures::stream::iter(...).buffer_unordered(MAX_CONCURRENT_SUBAGENTS)`; each emits
  `running`/`done`/`failed` and runs `Box::pin(run_agent_loop(...))` (the box breaks the
  `run_agent_loop ↔ run_subagents` type recursion). Returns `aggregate_summaries(...)` + the
  subagents' summed `Usage`, folded into the orchestrator response.
- **`research.rs`** (pure, unit-tested) — `DISPATCH_TOOL_NAME`, caps (`MAX_SUBTASKS=6`,
  `MAX_CONCURRENT_SUBAGENTS=4`, `SUBAGENT_MAX_ROUNDS=4`), prompts, `dispatch_tool_def()`,
  `parse_subtasks()`, `aggregate_summaries()`.
- **`providers/mod.rs`** — additive `StreamDelta.subagent: Option<SubagentDelta>` (id, phase,
  task?, summary?) + a constructor; `Usage::add` for folding. All omitted-when-None, so the
  no-research wire is unchanged.
- **Migration `020_deep_research.sql`** — `threads.deep_research INTEGER NOT NULL DEFAULT 0`.

### Frontend (`src/`)

- **`lib/chat.ts`** — `SubagentEvent`, `StreamEvent.subagent`, `chatStream(..., deepResearch)`.
- **`lib/db.ts` / `types/db.ts`** — `Thread.deep_research`, `setThreadDeepResearch`.
- **`lib/messages.ts`** — `MessageSubagent`, `MessageView.subagents`, `applySubagentEvent`,
  `persistableSubagent`, parse `kind="subagent"` attachments in `loadThreadMessages`.
- **`store/threads.ts`** — `draftDeepResearch` + `setDeepResearch`; `send`/`regenerate` read the
  effective flag (thread row or draft), accumulate `subagents` in `onDelta`, and persist them as
  `subagent` attachments alongside tool calls. A draft's flag is written onto the new thread row.
- **`components/chat/Composer.tsx`** — a `Telescope` toggle button (pressed style when on).
- **`components/chat/MessageList.tsx`** — `SubagentCard` (collapsible: status + task + Markdown
  summary), rendered next to the tool-activity stack.
- **i18n** — `composer.deepResearch*` + `chat.subagent*` keys in the catalog + all five packs.

## Concurrency, cost, cancellation

- Caps: subagent concurrency is **configurable** (Settings → Advanced; default 3, max 8),
  6 subtasks/dispatch, 4 rounds/subagent, orchestrator bounded by `MAX_TOOL_ROUNDS=5`. Only
  summaries (not transcripts) re-enter the orchestrator's context.
- **Rate limits:** firing several subagents at one provider trips thin tiers' per-minute 429.
  `providers::send_with_retry` retries 429/502/503/504 + connect/timeout with exponential
  backoff (honoring `Retry-After`, cancel-aware) for the cloud providers. Subagents also run
  under the full tool-use system prompt so weak models reliably summarize after searching.
- A dispatch of 6 subtasks × 4 rounds is up to ~24 extra provider calls; the cap throttles
  concurrency, not total spend. Subagent usage is summed into the assistant message's usage so
  the cost is visible.
- The single `CancelFlag` is shared with every subagent loop; one `cancel_stream` halts the
  orchestrator and all subagents (each provider SSE loop early-exits with partial text). Queued
  `buffer_unordered` futures are dropped when `run_subagents` returns.

## Risks & mitigations

- **Recursion / fan-out explosion** — structurally impossible (subagents lack the dispatch tool).
- **Partial failure** — a subagent error becomes a `FAILED: <reason>` line; the batch survives.
- **Provider tool-format differences** — none new; the dispatch tool is a normal `ToolDef`, and
  interception keys on the tool *name* (works for Gemini's synthesized ids).
- **Persistence** — `attachments.kind` is free-form text; `subagent` needs no migration.

## Deferred

- Per-subagent nested tool-activity / source panels in the card (would need cross-channel
  delta tagging). v1 shows the subagent's summary, which cites its sources in text.
- A configurable, cheaper subagent model (e.g. Haiku) to cut cost.

## Verification

- Rust: `cargo build`/`clippy`/`fmt`/`test` (129) — incl. `research.rs` (schema, parsing bounds,
  aggregation) and a `StreamDelta` test proving `subagent` is omitted when absent.
- Frontend: `npm run build`/`lint`/`test` (552) — incl. `applySubagentEvent` / `persistableSubagent`.
- Manual E2E (`npm run tauri dev`): toggle off ⇒ no `research` tool on the wire; toggle on ⇒
  multi-angle question spawns subagent cards (dispatched → running → done), summaries synthesize
  into the final answer; Stop mid-research halts everything; reload rehydrates the cards and the
  toggle persists; spot-check across the four cloud providers.
