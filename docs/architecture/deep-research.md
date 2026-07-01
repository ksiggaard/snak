# Deep research

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

A per-thread toggle (`threads.deep_research`, migration `020`) that turns a hard research
question into **parallel subagents** instead of one model working tool-by-tool. Recorded as
**ADR-0009**.

- When on, the orchestrator gets a `research__dispatch` tool (`src-tauri/src/research.rs`). Calling it spawns N subagents via `run_subagents` (`commands/chat.rs`), each a fresh `[system, user]` history running its own `run_agent_loop` with the web tools **but not** `dispatch` (depth-bounded to 1). Concurrency is a per-thread setting, clamped `[1, 8]` (default 3).
- Subagent provider/tool deltas are swallowed (only lifecycle events reach the UI); each returns a summary, the summaries are aggregated into one tool result, and the orchestrator synthesizes the answer with source citations. Subagent token usage is attributed to the main request.
