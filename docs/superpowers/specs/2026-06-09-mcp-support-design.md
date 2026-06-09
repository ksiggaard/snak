# T13 — MCP support with a built-in web-browsing server

**Status:** approved (Wave4-T13)
**Date:** 2026-06-09

## Goal

Add Model Context Protocol (MCP) support so the chat app can use external tools,
and ship an out-of-the-box web-browsing MCP server that works with no setup. The
model emits tool calls → we execute them via MCP → feed results back → continue,
all while preserving the existing SSE text streaming of the final answer.

Hard constraint: when no MCP server is enabled or no tools are available, behavior
is **byte-identical** to today — no `tools` field is sent and the chat path is
unchanged.

## Architecture overview

Three layers, all in scope:

1. **Rust MCP client** (`src-tauri/src/mcp/`) — connects to configured MCP servers,
   lists their tools, and dispatches `tools/call`. Two transports: **stdio**
   (spawn a child process, JSON-RPC over stdin/stdout, newline-framed) and
   **HTTP** (JSON-RPC POST per the MCP Streamable HTTP shape). Plus one
   **built-in** in-process web-browse server (no subprocess) so the default works
   everywhere with zero config.

2. **Provider tool exposure** (`src-tauri/src/providers/`) — `CompletionRequest`
   gains an optional `tools: &[ToolDef]`. Each provider maps `ToolDef` to its own
   tool schema and parses tool calls out of its stream:
   - Anthropic: top-level `tools` (`name`/`description`/`input_schema`);
     `tool_use` content blocks streamed via `content_block_start` +
     `input_json_delta`; stop_reason `tool_use`.
   - OpenAI/Mistral: `tools` (`type:function`) + streamed `tool_calls` deltas
     (index-keyed, `function.arguments` string fragments); finish_reason
     `tool_calls`.
   - Gemini: `tools:[{functionDeclarations:[…]}]`; `functionCall` parts in the
     candidate; stop when a functionCall part appears.

3. **Tool-call round-trip loop** (`commands/chat.rs`) — `chat_stream` runs the
   loop server-side: call provider → if it returned tool calls, execute each via
   the MCP client, append the assistant tool-call turn + tool-result turn to the
   message history, and call the provider again. Repeat up to a max-round cap.
   Text deltas stream to the frontend throughout; only the final round's text is
   the authoritative answer. The `chat_stream` signature and the frontend
   `chatStream`/`send` contract are unchanged.

## Key types (Rust)

```
// providers/mod.rs
pub struct ToolDef { name, description, input_schema: serde_json::Value }   // JSON Schema
pub struct ToolCall { id: String, name: String, arguments: serde_json::Value }
// ChatResponse gains: pub tool_calls: Vec<ToolCall>  (empty = no tools requested)
// CompletionRequest gains: pub tools: &'a [ToolDef]  (empty slice = send no tools)
```

A provider sends a `tools` field **only when the slice is non-empty** — this is
the byte-identical guarantee. Each `Provider::stream` accumulates tool-call
fragments alongside text and returns them in `ChatResponse.tool_calls`.

## MCP client design

- **Transport trait**: `initialize() -> ServerInfo`, `list_tools() -> Vec<McpTool>`,
  `call_tool(name, args) -> CallResult`. JSON-RPC 2.0 over the chosen channel.
- **Stdio**: spawn the command, write `\n`-terminated JSON-RPC requests, read
  responses line-framed; correlate by request id.
- **HTTP**: POST JSON-RPC to the server URL; parse the JSON response (or the
  first SSE `data:` if the server replies as a stream).
- **Built-in web-browse server**: an in-process implementation of the same
  transport trait. Exposes one tool, `fetch_url`, that GETs a URL with `reqwest`,
  strips HTML to readable text (basic tag/script/style removal, length-capped),
  and returns the text. No network spawning; always available.
- **Registry / manager** (`McpManager` in Tauri managed state): holds the set of
  configured + enabled servers, lazily connects, aggregates `list_tools` across
  all enabled servers into a flat `Vec<ToolDef>` (tool names namespaced
  `server__tool` to avoid collisions), and routes `call_tool` back to the owning
  server.

## Configuration & settings

- Server config persisted by the **frontend** in the `settings` table
  (key `mcp_servers`, JSON array of `{id, label, transport, command?/url?, enabled}`),
  consistent with the Stage-1 "frontend owns the DB" rule. The built-in
  web-browse server is a synthetic always-present entry (enabled by default,
  not removable).
- On `chat_stream`, the command reads the enabled server list (passed as an arg
  from the frontend, mirroring how messages/model are passed) and builds the tool
  list. **If the resulting tool list is empty, no tools are sent** and the loop
  degenerates to exactly one provider call = today's behavior.
- New commands: `mcp_list_tools(servers)` (settings UI "test/refresh") and the
  built-in list is always included. Settings card `McpServers.tsx` (enable/disable
  built-in, add/remove custom stdio/HTTP servers).

## Round-trip loop

```
messages = history
for round in 0..MAX_ROUNDS (=5):
    resp = providers::stream(provider, {messages, tools})   // streams text deltas
    if resp.tool_calls is empty: return resp                // normal completion
    append assistant turn carrying resp.tool_calls
    for call in resp.tool_calls:
        result = mcp.call_tool(call.name, call.arguments)   // or error string
        append tool-result turn (role tool / tool_result block)
// cap hit: return last resp (best-effort)
```

Cancellation: the existing `CancelFlag` is checked between rounds and inside each
provider stream (unchanged), so a cancel mid-tool-loop still resolves with partial
text.

## No-tools invariant (verification)

- Frontend `send()` / `chatStream()` are unchanged; the new `servers` arg defaults
  to the persisted list, which when only the built-in disabled → empty tools.
- `CompletionRequest.tools` is an empty slice by default; each provider guards
  `if !tools.is_empty()` before adding the `tools` field. Existing usage-capture
  SSE parsing is extended (new match arms for tool-call events), never replaced —
  `for_each_sse_data` signature stays identical.

## Testing

Rust unit tests (no network):
- Per-provider tool-schema mapping (`ToolDef` → Anthropic/OpenAI/Gemini JSON).
- Per-provider tool-call parse from representative SSE fragments.
- Built-in web-browse HTML→text extraction.
- MCP JSON-RPC request framing / response correlation (stdio line parse).
- Tool-name namespacing/round-trip in the manager.

Frontend: `mcp.ts` wrapper unit test (config (de)serialization / default built-in).

## Out of scope

- MCP resources/prompts (only tools).
- OAuth/credential flows for remote MCP servers (custom servers carry their own
  auth in the command/URL the user provides).
- Wiring MCP as a T12 plugin category (kept a dedicated subsystem this wave).
