# Stateful per-thread MCP sessions (via rmcp)

**Date:** 2026-06-15
**Status:** Design approved, pending spec review
**Builds on:** `2026-06-09-mcp-support-design.md` (T13, the current MCP client + settings UI)

## Problem

snak's MCP stdio transport is **stateless**: `stdio_roundtrip` (`src-tauri/src/mcp/mod.rs`)
spawns a fresh child process for *every* tool call, sends `initialize` + one request, then
kills the child. This works for one-shot tools (a calculator, a fetch) but breaks any
**session-based** server that holds state across calls — the driving example being
[`mozilla/firefox-devtools-mcp`](https://github.com/mozilla/firefox-devtools-mcp), which
controls a live Firefox instance (navigate → inspect → click → evaluate). With per-call
spawning, every call relaunches Firefox and loses all browser state, so multi-step flows
are impossible. Three concrete gaps:

1. **No session persistence** — process killed after each call (`mcp/mod.rs` `stdio_roundtrip`).
2. **Incomplete handshake** — `initialize` and the request are pipelined without waiting for
   the init response, and the required `notifications/initialized` is never sent. SDK-based
   servers may reject calls made before init completes.
3. **No `env` support** — the Mozilla config passes `env: { START_URL }`; neither the Rust
   `ServerConfig` nor the frontend `McpServer` has an env field.

## Goal

Support session-based external **stdio** MCP servers by keeping each one alive as a
persistent process, **scoped per chat thread**, with a spec-correct handshake. Adopt the
official Rust MCP SDK (`rmcp`) for the external-stdio transport. firefox-devtools-mcp is the
acceptance target; language servers and other stateful stdio servers work for free.

Non-goal for v1: changing the HTTP transport or the built-in in-process servers (see Scope).

## Decisions (from brainstorming)

- **Scope:** general stateful MCP support, not a firefox-only hack.
- **Lifecycle:** **per-thread** sessions — each chat thread gets its own server process
  (isolated browser/state per conversation), at the cost of plumbing the thread id through.
- **Implementation:** adopt **rmcp** (the official SDK). Its `RunningService` is an
  internally-actor'd, id-correlating, persistent client session — it *is* our session object,
  with handshake/framing/notifications handled inside the crate.
- **Idle timeout:** ~10 minutes (keeps headless Firefox from lingering forever).
- **Spawn failures:** surface a one-line chat note rather than failing fully silently.

## Architecture

### What changes vs. stays

- **Replaced:** the hand-rolled external-stdio path — `stdio_roundtrip`, `list_stdio_tools`,
  `call_stdio_tool`, and the `split_command`/handshake helpers that only that path uses —
  with rmcp-backed persistent sessions.
- **Unchanged:**
  - The three **built-in in-process** servers (`web`, `youtube`, `sys`) — they are not
    MCP-over-a-wire, so `builtin_tools`/`builtin_call` stay exactly as-is.
  - **External HTTP** servers stay on today's stateless JSON-RPC POST (`http_roundtrip`).
  - Tool aggregation/namespacing (`<server>__<tool>`), approval gating (`requires_approval`,
    `sys` only), and the **no-tools invariant** (empty server list ⇒ no `tools` field ⇒
    byte-identical plain completion).

### rmcp dependency

```toml
# src-tauri/Cargo.toml
rmcp = { version = "1.7", features = ["client", "transport-child-process"] }
```

Spawn + handshake + call pattern (verified against rmcp 1.7):

```rust
use rmcp::{ServiceExt, transport::{TokioChildProcess, ConfigureCommandExt}};
use rmcp::model::CallToolRequestParam;
use tokio::process::Command;

let transport = TokioChildProcess::new(
    Command::new(&prog).configure(|c| { c.args(&args); c.envs(&env_map); })
)?;
let svc = ().serve(transport).await?;          // runs initialize + initialized
let tools = svc.list_tools(Default::default()).await?;
let res   = svc.call_tool(CallToolRequestParam { name, arguments }).await?;
svc.cancel().await?;                           // graceful shutdown
```

`svc` is a `RunningService<RoleClient, _>`; `svc.peer()` yields a cloneable `Peer` for calls
while the `RunningService` is held alive in the manager.

### Session manager (`src-tauri/src/mcp/session.rs`, new)

A `McpSessions` struct held in Tauri managed state (alongside `CancelFlag`/`PendingApprovals`
in `lib.rs`):

- **Map:** `(thread_id, server_id) → Session { svc: RunningService, last_used: Instant, fingerprint: u64 }`,
  behind a `tokio::sync::Mutex`.
- **`fingerprint`** = hash of the server's launch-relevant config (command + args + env +
  enabled). Used to invalidate a session when its config changes.
- **`get_or_create(thread_id, &ServerConfig) -> Result<Peer>`:** return the live peer if a
  session exists and its fingerprint matches; otherwise spawn the rmcp transport (command
  split into prog+args, env applied), `().serve()`, store the `RunningService`, bump
  `last_used`, return `svc.peer()`. **Single-flight:** guard so two concurrent first-calls for
  the same key spawn only once (hold the lock across spawn, or a per-key in-flight latch).
- External-stdio `list_tools`/`call_tool` route through this; rmcp handles request
  id-correlation, so even parallel tool calls within one turn are safe over one session.

### Lifecycle / teardown

A session is born lazily on the first tool list/call for that thread+server and reused across
every later message in that thread. It dies on:

- **Idle timeout** — a reaper task spawned in `setup()` scans periodically (~60 s) and
  `cancel()`s sessions idle > ~10 min.
- **Thread deletion** — new command `mcp_close_thread_sessions(thread_id)`, called from the
  store's `remove`/`deleteThread` (`src/store/threads.ts`).
- **Config change / disable** — fingerprint mismatch on next `get_or_create` invalidates and
  respawns; a disabled/edited server's stale sessions are closed.
- **App exit** — cancel all sessions on shutdown.

### Plumbing changes

- **`ServerConfig` (Rust):** add `env: Option<HashMap<String, String>>`. It's a nested field
  inside the `servers` array arg, so (like `search_provider`) it is **not** camelCase-converted
  by Tauri — sent as-is.
- **`chat_stream`:** add a top-level `threadId` arg (Tauri camel→snake → `thread_id`), passed
  by the `chatStream` wrapper in `src/lib/chat.ts`. The thread always exists by then (the store
  persists the user message first — `store/threads.ts` `send`).
- **`mcp::list_tools` / `mcp::call_tool`:** gain `&McpSessions` + `thread_id` params; the
  builtin/http paths ignore them.
- **Command parsing:** keep whitespace-split (`npx -y @mozilla/firefox-devtools-mcp@latest
  --headless` splits cleanly). Structured args array is a deferred follow-up.
- **Registration:** `.manage(McpSessions::default())` and `mcp_close_thread_sessions` in the
  `invoke_handler!` list (`lib.rs`).

### Error handling

- **Spawn/handshake failure** → that server contributes no tools (today's graceful default in the
  chat path). Surfacing: (a) the **settings** "refresh tools" returns per-server errors (a
  `{ tools, errors }` report), so a broken server shows *why* against its row instead of silently
  listing nothing; (b) in the live-chat path the failure is logged to stderr (dev-visible). An
  in-chat failure note to the user is a **deferred** follow-up (it needs the `on_delta` channel
  plumbed into tool-listing). Never fully silent.
- **`call_tool` over a dead session** → one respawn+retry, else return the error string the
  loop already feeds back to the model (so a bad call doesn't abort the turn).

## Settings UI (manage servers in-app)

The add/manage UI already exists from T13 (`src/components/settings/McpServers.tsx`): add
custom stdio/http servers (label + transport + command/url), per-server enable/disable toggle,
remove (with confirm), and a global "refresh tools" that lists every enabled server's tools.
This design **extends** it:

1. **Env vars (stdio):** a key=value editor in the add form (and edit form below) for stdio
   servers, persisted to the new `env` field. Hidden for http.
2. **Edit existing custom servers:** today you can only add/remove. Add an inline edit affordance
   for custom servers (label, command/url, env) so "manage" means edit, not delete-and-re-add.
   Editing changes the config fingerprint, which invalidates any live sessions.
3. **Surface spawn/connection errors:** when `refresh tools` (or a per-server "test") fails to
   start a server, show the error against that server rather than only the global error line.

All three are additive to the existing card; persistence stays via `saveServers` →
`settings.mcp_servers`. New i18n keys added to `src/locales/*` following existing `mcp.*` keys.

## Scope boundaries & follow-ups

**v1:** external **stdio** persistent sessions only.

**Deferred (noted, not built):**
- Route external **HTTP** servers through rmcp's `transport-streamable-http-client` for proper
  `Mcp-Session-Id` sessions (today's stateless POST stays for v1).
- Structured args array (vs. whitespace-split command).
- Per-server configurable idle timeout.
- Long-lived session pooling for HTTP / built-in (not needed — built-ins are in-process).

## Testing

- **Unit (pure bookkeeping):** key derivation, config-fingerprint computation + invalidation,
  idle-reaper selection given a set of `last_used` timestamps, command + env parsing.
- **Integration (`#[ignore]`d):** drive a tiny mock stdio MCP server committed under test
  fixtures (a minimal one-file server) so CI needs no network/node; run manually.
- **Manual end-to-end:** firefox-devtools-mcp via `npx -y @mozilla/firefox-devtools-mcp@latest
  --headless` — navigate in message 1, inspect/act in message 2 within the same thread, confirm
  state persists; confirm a *new* thread gets an isolated session; confirm idle teardown.

## Risks

- **rmcp API churn:** pin to `1.7`; the client/stdio surface used here (`ServiceExt::serve`,
  `TokioChildProcess`, `list_tools`/`call_tool`/`cancel`) is small and stable.
- **Resource leaks:** headless browsers are heavy — the idle reaper + thread-delete + app-exit
  teardown are load-bearing, not optional. Verify processes actually exit (`graceful_shutdown`).
- **Per-thread process count:** N threads × M enabled stateful servers = N×M processes. Idle
  timeout bounds this; acceptable given typical use, revisit if it bites.
- **First-call latency:** spawning Firefox on the first tool call in a thread is multi-second.
  Acceptable (it's the session being established); the UI's "running tool" indicator covers it.
