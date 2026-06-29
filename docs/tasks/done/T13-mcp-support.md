# T13 — MCP support (with built-in web-browsing server)

- **Status:** done
- **Owner:** Wave4-T13
- **Priority:** P2
- **Layer:** Rust (MCP client + tool dispatch) + Frontend
- **Depends on:** —

(README idea 6.) Support the Model Context Protocol so the app can use external tools, and
ship an out-of-the-box MCP server for web browsing.

**Acceptance criteria:**
- An MCP client in the Rust backend that connects to configured MCP servers and exposes
  their tools to the model via each provider's tool-use API.
- The streaming chat loop (`commands/chat.rs`, `providers/`) handles tool-call rounds
  (request tool → execute via MCP → feed result back) without breaking SSE streaming.
- A bundled/default web-browsing MCP server works out of the box; servers are configurable
  in settings.

**Notes:**
- Tool use differs per provider — consult the `claude-api` skill for Anthropic tool-use and
  MCP specifics before implementing the request/response shapes.
- 2026-06-09 (Wave4-T13): Done. Rust MCP client at `src-tauri/src/mcp/` (stdio +
  HTTP JSON-RPC transports + in-process built-in web-browse server `fetch_url`),
  tools aggregated + namespaced `<server>__<tool>`. `CompletionRequest.tools` /
  `ChatResponse.tool_calls` added; all four providers map tool schemas + parse
  tool calls from their streams. `chat_stream` runs the server-side tool-call
  loop (max 5 rounds) while preserving SSE text streaming; sends no `tools` when
  the enabled-server list is empty → no-tools path byte-identical. Frontend:
  `src/lib/mcp.ts` (config persisted in `settings.mcp_servers`, read inside
  `chatStream` so `threads.ts` is untouched) + `McpServers` settings card. Design
  doc: `docs/superpowers/specs/2026-06-09-mcp-support-design.md`. Verified:
  cargo build/clippy/fmt/test (41) + npm build/lint/test (114).
