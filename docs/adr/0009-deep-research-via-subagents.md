# ADR-0009: Deep research runs as dispatched parallel subagents

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-30

## Context and Problem Statement

The standard chat path ([ADR-0002](./0002-provider-calls-in-rust-over-http.md) + the MCP tool loop, [ADR-0008](./0008-mcp-stateful-per-thread-sessions.md)) handles tool use as one model working one tool call at a time in a single context. A genuinely involved research question — "compare X, Y, and Z with current pricing and sentiment" — is poorly served by that: independent angles are investigated serially, and every raw search result and fetched page lands in the one conversation, crowding the model's working memory and inflating cost. We need a mode that parallelizes independent investigation and keeps each angle's noise out of the main context.

## Decision Drivers

* Parallelism — independent sub-questions should run concurrently, not serially
* Context hygiene — raw tool output should not pollute the orchestrator's context
* Decomposition — the model should hand a focused sub-question to a worker that reports only its conclusion
* Reuse — avoid a second, parallel agent implementation to maintain

## Considered Options

* **Option 1:** An orchestrator dispatches N subagents via a `research__dispatch` tool; each runs the existing agent loop in its own context and returns only a summary
* **Option 2:** Keep the single sequential tool loop, just allow more tool rounds / a longer budget
* **Option 3:** A bespoke parallel research engine separate from the chat agent loop

## Decision Outcome

Chosen option: **Option 1 — dispatched subagents reusing the agent loop**, because it delivers parallelism and context isolation while reusing `run_agent_loop` rather than building a second engine. Deep research is a per-thread toggle (`threads.deep_research`, migration `020`). When on, the orchestrator is given a `research__dispatch` tool (`src-tauri/src/research.rs`); calling it spawns N subagents through `run_subagents` (`src-tauri/src/commands/chat.rs`). Each subagent is a fresh `[system: subagent prompt, user: task]` history running its own `run_agent_loop` with the web tools **but without** `dispatch` (depth-bounded to 1, so subagents can't recurse). Concurrency is a per-thread setting clamped to `[1, 8]` (default 3). Subagent provider/tool deltas are swallowed — only lifecycle events (dispatched → running → done/failed) reach the UI — and each subagent returns a summary; the summaries are aggregated into a single tool result the orchestrator synthesizes into a cited answer. Subagent token usage is tallied back to the main request, not hidden.

### Consequences

* **Positive:** Independent angles run concurrently; each subagent's raw search/fetch noise stays in its own context, so the orchestrator sees only conclusions. It reuses the existing loop (one agent implementation, not two). Depth-bounding prevents runaway fan-out, and usage is honestly attributed.
* **Negative:** Fan-out multiplies token spend (N concurrent contexts), so the mode is opt-in per thread. The dispatch tool is a pseudo-tool the orchestrator must be prompted to use well, and swallowing subagent deltas means the UI shows progress, not reasoning — a deliberate trade of transparency for a clean main context. A bounded concurrency window (≤8) caps throughput on very broad questions.

## Pros and Cons of the Options

### Option 1 — Dispatched subagents reusing the loop

* **Good:** Parallel + context-isolated + decomposed; reuses `run_agent_loop`.
* **Good:** Depth bound and concurrency clamp keep cost and recursion in check; usage is attributed.
* **Bad:** Higher token spend; subagent reasoning isn't surfaced to the UI.

### Option 2 — Longer single sequential loop

* **Good:** No new machinery; fully transparent in one stream.
* **Bad:** Still serial; still pollutes one context with all raw tool output — the exact problems this exists to fix.

### Option 3 — Bespoke parallel research engine

* **Good:** Could be tuned specifically for research.
* **Bad:** A second agent implementation to build and maintain in parallel with the chat loop.
