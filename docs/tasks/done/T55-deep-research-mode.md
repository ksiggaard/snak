# T55 — Deep research mode (parallel research subagents)

- **Status:** done
- **Owner:** Claude (T55)
- **Priority:** P2
- **Layer:** Rust (agent loop + dispatch) + Frontend (toggle + cards + persistence)
- **Depends on:** T13 (MCP + built-in web server, tool-call loop), T52 (web search)

(IDEA 26.) A per-thread toggle that lets the model spend more time investigating. When on, the
model (orchestrator) can call a `research__dispatch` tool to launch multiple **subagents** that
investigate subtasks — in parallel when independent, or sequentially across rounds when it needs
one answer before knowing the next question. Each subagent runs with its **own fresh context** and
the web tools, and returns only a concise summary, so the orchestrator's context isn't polluted by
raw search dumps. The UI shows each subagent being dispatched and its progress.

**Acceptance criteria:**
- A per-thread, persisted "Deep research" toggle in the Composer; off ⇒ behavior byte-identical to
  today (no `research` tool on the wire, no extra system prompt).
- The orchestrator can dispatch N subagents that run concurrently (capped) and gather info with the
  web tools, returning concise summaries the orchestrator synthesizes.
- Subagents cannot recurse (no dispatch tool in their tool list); one cancel halts everything.
- Subagent cards (dispatched → running → done/failed, task + summary) render in the chat and survive
  reload.

**Design:** `docs/superpowers/specs/2026-06-15-deep-research-mode-design.md`.

**Notes:**
- 2026-06-15 (Claude): **Backend** — extracted `chat_stream`'s tool loop into a reusable
  `run_agent_loop` (`src-tauri/src/commands/chat.rs`); the orchestrator calls it with an added
  `research__dispatch` tool (`deepResearch` arg gates it + a decomposition system prompt). A
  `research__dispatch` call is intercepted (`run_subagents`) and runs one subagent per subtask via
  the *same* loop over a fresh `[system(SUBAGENT_PROMPT), user(task)]` history with web tools only,
  `allow_dispatch=false` (depth bound 1), concurrently with
  `futures::buffer_unordered(MAX_CONCURRENT_SUBAGENTS=4)`; subagent internals stream to a throwaway
  sink `Channel` so only the lifecycle reaches the UI. Subagent token usage is summed into the
  orchestrator's `usage`. New pure module `src-tauri/src/research.rs` (tool descriptor, prompts,
  `parse_subtasks`, `aggregate_summaries`; unit-tested). New `StreamDelta.subagent` (`SubagentDelta`:
  id/phase/task/summary) in `providers/mod.rs`. Migration `020_deep_research.sql` adds
  `threads.deep_research`. **Frontend** — `chatStream` gained a `deepResearch` flag;
  `StreamEvent.subagent` + `SubagentEvent`; `MessageSubagent` + `applySubagentEvent` +
  `persistableSubagent` persisted as `kind="subagent"` attachments (`src/lib/messages.ts`); store
  `draftDeepResearch` + `setDeepResearch` + `thread.deep_research` threaded through `send`/
  `regenerate` (`src/store/threads.ts`); a `Telescope` toggle in `Composer.tsx` and a `SubagentCard`
  in `MessageList.tsx`; i18n keys in the catalog + all five packs. **Deferred (v1):** per-subagent
  nested tool-activity/source panels in the card, and a configurable cheaper subagent model — the
  card shows the summary (which cites its sources) and subagents inherit the thread's model.
  Verified: `cargo build`/`clippy`/`fmt`/`test` (129); `npm run build`/`lint`/`test` (552).
- 2026-06-15 (Claude, follow-up after first live test on Mistral showed 429s + empty
  summaries): **(1)** subagents now run under the FULL `TOOL_SYSTEM_PROMPT` + the subagent
  addendum (was the addendum only), so weak models reliably write a summary after searching
  instead of falling silent (`run_subagents`, `commands/chat.rs`). **(2)** subagent
  concurrency is configurable in **Settings → Advanced** (default lowered 4→3): new
  `Advanced.tsx` card + `deep_research_concurrency` setting (`getDeepResearchConcurrency`/
  `setDeepResearchConcurrency`, `lib/db.ts`), `chatStream` passes `subagentConcurrency`,
  threaded through `run_agent_loop`→`run_subagents`; `research::{DEFAULT_SUBAGENT_CONCURRENCY,
  MAX_SUBAGENT_CONCURRENCY, clamp_concurrency}`. **(3)** transient-failure retry with
  exponential backoff (honoring `Retry-After`, cancel-aware) for 429/502/503/504 + connect/
  timeout: shared `providers::send_with_retry` applied to anthropic/openai(+mistral)/gemini
  (not ollama — local, and it would delay the friendly "daemon down" error). New i18n
  (`advanced.*`, `common.default`) in the catalog + five packs. Verified: `cargo build`/
  `clippy`/`fmt`/`test` (132); `npm run build`/`lint`/`test` (552).
