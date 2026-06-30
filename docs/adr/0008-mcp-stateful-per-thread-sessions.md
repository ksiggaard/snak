# ADR-0008: MCP servers run as stateful per-thread sessions

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-30

## Context and Problem Statement

snak supports tools via the Model Context Protocol. Built-in tools (web browse/search, youtube, device, image search, the skill server) run in-process, but external `stdio` MCP servers are child processes that speak JSON-RPC over stdin/stdout, and the protocol's `initialize` handshake plus any server-side state (an opened file, a logged-in session) is **per connection**. We must decide the lifetime of those connections: spawn-per-call (stateless) or a longer-lived session, and if longer-lived, scoped to what.

## Decision Drivers

* Correctness — a server that holds state between calls must see one continuous connection
* Latency — re-spawning a process and re-running `initialize` on every tool call is slow
* Isolation — one thread's server state must not bleed into another thread
* Resource hygiene — child processes must not leak; they must be reaped deterministically

## Considered Options

* **Option 1:** One persistent session per `(thread_id, server_id)`, reused across the thread's messages, reaped on idle/teardown
* **Option 2:** Stateless — spawn the server, run `initialize`, make the call, tear down, every tool call
* **Option 3:** One global session per server, shared across all threads

## Decision Outcome

Chosen option: **Option 1 — a persistent session keyed by `(thread_id, server_id)`**, because it is the only option that is both correct for stateful servers and fast, while keeping threads isolated. Sessions live in an `McpSessions` registry (`src-tauri/src/mcp/session.rs`), initialized lazily on the first list/call and reused for the rest of the thread's messages. They are torn down on a set of explicit triggers: an idle reaper (runs ~every 60 s, ~10-minute idle window), thread deletion (`mcp_close_thread_sessions`), a server config-fingerprint change (`mcp_close_server_sessions`), and app exit. On a transport failure the session is dropped and the call retried once. `http` servers are treated as stateless (a fresh request per call), since HTTP has no equivalent long-lived channel. Tools are namespaced `<server-id>__<tool>` to avoid collisions, and the whole machinery stays behind the no-tools invariant (no enabled server ⇒ no `tools` field).

### Consequences

* **Positive:** Stateful `stdio` servers work correctly (one continuous connection per thread), and warm sessions avoid per-call spawn + handshake latency. Thread isolation is structural — the key includes `thread_id`. Teardown is deterministic across idle, delete, reconfigure, and exit, so processes don't leak.
* **Negative:** A session registry with a background reaper is real lifecycle complexity (vs. the trivial stateless model), and warm child processes consume resources between calls until reaped. Config changes must invalidate sessions by fingerprint or a thread keeps talking to a stale server. The frontend owns the server list (`settings.mcp_servers`) while Rust owns session lifetime, so the two must stay coordinated.

## Pros and Cons of the Options

### Option 1 — Persistent per-thread session

* **Good:** Correct for stateful servers; warm sessions are low-latency; threads are isolated.
* **Good:** Deterministic teardown (idle reaper + delete/reconfigure/exit hooks).
* **Bad:** Lifecycle complexity (registry + reaper + fingerprint invalidation); idle processes hold resources.

### Option 2 — Stateless spawn-per-call

* **Good:** Trivial lifetime — nothing to reap, nothing to invalidate.
* **Bad:** Breaks any server that holds state between calls; pays spawn + `initialize` cost on every call.

### Option 3 — One global session per server

* **Good:** Fewer processes than per-thread; still warm.
* **Bad:** One thread's server state leaks into another — no isolation; concurrent threads contend on one connection.
