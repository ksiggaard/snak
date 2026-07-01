# MCP & tools

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

snak can use **tools** via the Model Context Protocol, with the **no-tools invariant**: when no
server is enabled, the request is byte-identical to a plain completion (no `tools` field, the
chat path unchanged).

- **The agent loop** lives in `run_agent_loop` (`src-tauri/src/commands/chat.rs`): stream the provider response → run any tool calls the model emits → append synthesized assistant/tool turns → repeat, bounded by `MAX_TOOL_ROUNDS`. A tool error feeds back as a text result rather than aborting; cancellation is a shared `AtomicBool` checked throughout. Some tools require explicit user approval (`approve_tool_call` command).
- **Built-in (in-process) servers** live under `src-tauri/src/mcp/`: `web` (`web_browse.rs` fetch + `web_search.rs`), `youtube`, `device`, `image_search`, `sys` (read-only diagnostics, ships disabled), and `skill` (the [Skills](./skills.md) tool server). Tools are namespaced `<server-id>__<tool>`.
- **External servers:** `stdio` (a child process per `(thread_id, server_id)`, persistent across a thread's messages, reaped on idle / thread-delete / config-change / exit — `mcp/session.rs`) and `http` (stateless POST). The design rationale for stateful sessions is **ADR-0008**.
- **Config ownership:** the frontend owns the server list (`settings.mcp_servers`, `src/lib/mcp.ts`); the built-in `skill` server is added to the enabled set only when ≥1 skill is enabled. Commands: `mcp_list_tools`, `mcp_close_thread_sessions`, `mcp_close_server_sessions`.
