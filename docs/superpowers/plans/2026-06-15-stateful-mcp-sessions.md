> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Stateful per-thread MCP sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep each external **stdio** MCP server alive as a persistent process scoped per chat thread, via the official `rmcp` SDK, so session-based servers like `firefox-devtools-mcp` work (navigate → inspect → act across messages).

**Architecture:** Adopt `rmcp` for the external-stdio transport — its `RunningService` is a persistent, id-correlating client session. A Tauri-managed `McpSessions` registry keys live sessions by `(thread_id, server_id)`, spawns lazily, reuses across a thread's messages, and tears down on idle / thread-delete / config-change / app-exit. Built-in in-process servers (`web`/`youtube`/`sys`) and external HTTP servers are unchanged.

**Tech Stack:** Rust (Tauri v2, tokio, `rmcp` 1.7, reqwest, anyhow, serde_json), React 19 + TypeScript (Zustand store, vitest), Python 3 (test fixture only).

**Spec:** `docs/superpowers/specs/2026-06-15-stateful-mcp-sessions-design.md`

---

## File Structure

**Created:**
- `src-tauri/src/mcp/session.rs` — the `McpSessions` registry: spawn/serve via rmcp, per-`(thread,server)` lifecycle, idle reaper, command/env parsing, fingerprinting. One responsibility: external-stdio session management.
- `src-tauri/tests/fixtures/mock_mcp_server.py` — a tiny stateful stdio MCP server (a counter) used only by the `#[ignore]`d integration test to prove persistence.

**Modified:**
- `src-tauri/Cargo.toml` — add the `rmcp` dependency.
- `src-tauri/src/mcp/mod.rs` — add `pub mod session;` + `env` field on `ServerConfig`; route the `Stdio` arm of `list_tools`/`call_tool` through `McpSessions`; delete the old hand-rolled stdio path; thread `&McpSessions` + `thread_id` into both fns and the `mcp_list_tools` command.
- `src-tauri/src/commands/chat.rs` — `chat_stream` gains `threadId` + `McpSessions` state, passed into `list_tools`/`call_tool`.
- `src-tauri/src/lib.rs` — `.manage(McpSessions)`, spawn the idle reaper in `setup()`, register `mcp_close_thread_sessions`, close-all on app exit.
- `src/lib/mcp.ts` — `env` on `McpServer`; pure `parseEnvText`/`formatEnvText`; `mcpCloseThreadSessions` wrapper.
- `src/lib/chat.ts` — `chatStream` gains a `threadId` arg, passed to `invoke`.
- `src/store/threads.ts` — pass the thread id at the 3 `chatStream` call sites; call `mcpCloseThreadSessions` in `remove`.
- `src/lib/personaMemory.ts` — the 4th `chatStream` caller (non-thread bot-memory summarization); pass a synthetic thread id.
- `src/store/threads.mentions.test.ts` — the one `toHaveBeenCalledWith(chatStream, …)` assertion gains the new arg.
- `src/lib/mcp.test.ts` — tests for `parseEnvText`/`formatEnvText` and `env` round-trip.
- `src/components/settings/McpServers.tsx` — env-vars field (stdio), edit existing custom servers, per-server spawn-error surface, session teardown on disable/edit/remove.
- `src/lib/i18n.ts` — new inline `mcp.envPlaceholder` + `common.edit` strings (canonical English source; extends the `MessageKey` type). Locale-pack (`src/locales/*.json`) translations are optional follow-ups.

---

## Task 1: Add the rmcp dependency

**Files:**
- Modify: `src-tauri/Cargo.toml:20-41` (the `[dependencies]` block)

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, directly after the `anyhow = "1"` line (currently line 35), add:

```toml
# Official MCP SDK — used as a client for external stdio MCP servers, giving us
# a correct initialize/initialized handshake and a persistent, id-correlating
# session per server (replaces the old spawn-per-call stdio path). T-stateful-mcp.
rmcp = { version = "1.7", features = ["client", "transport-child-process"] }
```

- [ ] **Step 2: Verify it resolves and builds**

Run: `cd src-tauri && cargo build`
Expected: compiles (downloads `rmcp` + `process-wrap`); no errors. First build is slow.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build: add rmcp (MCP client SDK) for stateful stdio sessions"
```

---

## Task 2: `env` field + config fingerprint (pure, TDD)

**Files:**
- Modify: `src-tauri/src/mcp/mod.rs:70-101` (the `ServerConfig` struct + impl)

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module at the bottom of `src-tauri/src/mcp/mod.rs` (before the closing `}`):

```rust
    fn cfg(command: &str, env: Option<HashMap<String, String>>) -> ServerConfig {
        ServerConfig {
            id: "x".into(),
            transport_kind: Some(Transport::Stdio),
            transport_alias: None,
            command: Some(command.into()),
            url: None,
            enabled: true,
            search_provider: None,
            env,
        }
    }

    #[test]
    fn fingerprint_is_stable_and_env_order_independent() {
        use std::collections::HashMap;
        let a = cfg("npx -y srv", Some(HashMap::from([
            ("A".to_string(), "1".to_string()),
            ("B".to_string(), "2".to_string()),
        ])));
        let b = cfg("npx -y srv", Some(HashMap::from([
            ("B".to_string(), "2".to_string()),
            ("A".to_string(), "1".to_string()),
        ])));
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn fingerprint_changes_with_command_env_and_enabled() {
        use std::collections::HashMap;
        let base = cfg("npx -y srv", None);
        let other_cmd = cfg("npx -y other", None);
        let with_env = cfg("npx -y srv", Some(HashMap::from([("A".to_string(), "1".to_string())])));
        let mut disabled = cfg("npx -y srv", None);
        disabled.enabled = false;
        assert_ne!(base.fingerprint(), other_cmd.fingerprint());
        assert_ne!(base.fingerprint(), with_env.fingerprint());
        assert_ne!(base.fingerprint(), disabled.fingerprint());
    }
```

Also add `use std::collections::HashMap;` at the top of `mod.rs` if not present (it isn't — add it after the existing `use` lines near line 30).

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test --lib mcp::tests::fingerprint`
Expected: FAIL — `no method named fingerprint` / `no field env`.

- [ ] **Step 3: Add the `env` field and `fingerprint` method**

In `ServerConfig` (after the `search_provider` field, ~line 87) add:

```rust
    /// Environment variables for a `Stdio` server's child process. Nested arg,
    /// so (like `search_provider`) it rides snake_case as-is from the frontend.
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
```

In `impl ServerConfig` (after `transport()`, ~line 100) add:

```rust
    /// A hash of the launch-relevant config (command + env + enabled). The session
    /// manager uses it to detect when a server was edited and respawn it.
    pub fn fingerprint(&self) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        self.command.hash(&mut h);
        self.enabled.hash(&mut h);
        // Sort env pairs so HashMap iteration order doesn't change the hash.
        let mut pairs: Vec<(&String, &String)> =
            self.env.as_ref().map(|m| m.iter().collect()).unwrap_or_default();
        pairs.sort();
        for (k, v) in pairs {
            k.hash(&mut h);
            v.hash(&mut h);
        }
        h.finish()
    }
```

Also update the existing `disabled_servers_contribute_no_tools` test's `ServerConfig { … }` literal (~line 626) to add `env: None,` so it still compiles.

- [ ] **Step 4: Run to verify it passes**

Run: `cd src-tauri && cargo test --lib mcp::tests`
Expected: PASS (all mcp tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mcp/mod.rs
git commit -m "feat(mcp): add env field + config fingerprint to ServerConfig"
```

---

## Task 3: Command/env parsing helper (pure, TDD)

**Files:**
- Create: `src-tauri/src/mcp/session.rs`
- Modify: `src-tauri/src/mcp/mod.rs` (add `pub mod session;`; remove the now-duplicate `split_command`)

- [ ] **Step 1: Create the module with the parse helper + its tests**

Create `src-tauri/src/mcp/session.rs`:

```rust
//! External-stdio MCP sessions via the `rmcp` SDK.
//!
//! Each enabled external **stdio** server is kept alive as a persistent child
//! process, scoped per chat thread. `rmcp`'s `RunningService` is the session: it
//! runs the initialize/initialized handshake once and correlates request ids, so
//! many `tools/call`s reuse one process and the server keeps its state across a
//! thread's messages. Sessions are torn down on idle, thread deletion, config
//! change, and app exit. Built-in and HTTP servers do NOT use this module.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context};
use rmcp::model::CallToolRequestParam;
use rmcp::service::{Peer, RunningService};
use rmcp::transport::{ConfigureCommandExt, TokioChildProcess};
use rmcp::{RoleClient, ServiceExt};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::ServerConfig;
use crate::providers::ToolDef;

/// Split a whitespace-delimited command line into (program, args).
fn parse_command(command: &str) -> anyhow::Result<(String, Vec<String>)> {
    let mut parts = command.split_whitespace();
    let prog = parts
        .next()
        .ok_or_else(|| anyhow!("empty stdio command"))?
        .to_string();
    Ok((prog, parts.map(|s| s.to_string()).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_program_and_args() {
        let (prog, args) = parse_command("npx -y @mozilla/firefox-devtools-mcp@latest --headless").unwrap();
        assert_eq!(prog, "npx");
        assert_eq!(args, ["-y", "@mozilla/firefox-devtools-mcp@latest", "--headless"]);
    }

    #[test]
    fn empty_command_errors() {
        assert!(parse_command("   ").is_err());
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/mcp/mod.rs`, in the `pub mod` block (lines 24-28), add (keep alphabetical):

```rust
pub mod session;
```

- [ ] **Step 3: Run to verify the new tests pass**

Run: `cd src-tauri && cargo test --lib mcp::session::tests`
Expected: PASS (2 tests). (There will be `dead_code` warnings for the rmcp imports until Task 4 — that's fine for now.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/mcp/session.rs src-tauri/src/mcp/mod.rs
git commit -m "feat(mcp): scaffold session module + command parsing"
```

---

## Task 4: Idle-reaper selection helper (pure, TDD)

**Files:**
- Modify: `src-tauri/src/mcp/session.rs`

- [ ] **Step 1: Write the failing test**

Add inside the `tests` module in `session.rs`:

```rust
    #[test]
    fn reap_targets_picks_only_expired() {
        let max = Duration::from_secs(600);
        let entries = [
            ("a", Duration::from_secs(700)), // expired
            ("b", Duration::from_secs(599)), // fresh
            ("c", Duration::from_secs(600)), // exactly at limit -> expired
        ];
        let mut got = reap_targets(&entries, max);
        got.sort();
        assert_eq!(got, ["a", "c"]);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test --lib mcp::session::tests::reap_targets`
Expected: FAIL — `cannot find function reap_targets`.

- [ ] **Step 3: Implement the helper**

Add to `session.rs` (above the `tests` module):

```rust
/// Keys whose idle time is at least `max_idle`. Pure, so it is unit-tested.
fn reap_targets<K: Clone>(entries: &[(K, Duration)], max_idle: Duration) -> Vec<K> {
    entries
        .iter()
        .filter(|(_, idle)| *idle >= max_idle)
        .map(|(k, _)| k.clone())
        .collect()
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd src-tauri && cargo test --lib mcp::session::tests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mcp/session.rs
git commit -m "feat(mcp): pure idle-reaper selection helper"
```

---

## Task 5: The `McpSessions` registry (rmcp spawn/serve/teardown)

**Files:**
- Modify: `src-tauri/src/mcp/session.rs`

- [ ] **Step 1: Implement the registry**

Add to `session.rs`, above the `tests` module:

```rust
/// One live session: the rmcp running service plus bookkeeping.
struct Session {
    svc: RunningService<RoleClient, ()>,
    last_used: Instant,
    fingerprint: u64,
}

/// Registry of live external-stdio MCP sessions, keyed by `(thread_id, server_id)`.
/// Cheaply clonable (Arc inside) so the idle-reaper task can hold a handle.
#[derive(Clone, Default)]
pub struct McpSessions {
    inner: Arc<Mutex<HashMap<(String, String), Session>>>,
}

impl McpSessions {
    /// Build the configured child-process command (program, args, env).
    fn build_command(server: &ServerConfig) -> anyhow::Result<tokio::process::Command> {
        let command = server
            .command
            .as_deref()
            .ok_or_else(|| anyhow!("stdio server `{}` has no command", server.id))?;
        let (prog, args) = parse_command(command)?;
        let env = server.env.clone().unwrap_or_default();
        Ok(tokio::process::Command::new(&prog).configure(|c| {
            c.args(&args);
            if !env.is_empty() {
                c.envs(&env);
            }
        }))
    }

    /// Return a cloned peer for `(thread_id, server)`, spawning + handshaking a new
    /// session if absent or if the server's config fingerprint changed. The map
    /// lock is held across spawn so concurrent first-calls spawn only once; the
    /// returned `Peer` is then used WITHOUT the lock (calls can be slow).
    async fn get_or_create(
        &self,
        thread_id: &str,
        server: &ServerConfig,
    ) -> anyhow::Result<Peer<RoleClient>> {
        let key = (thread_id.to_string(), server.id.clone());
        let fp = server.fingerprint();
        let mut map = self.inner.lock().await;

        if let Some(existing) = map.get(&key) {
            if existing.fingerprint == fp {
                let peer = existing.svc.peer().clone();
                // bump last_used
                map.get_mut(&key).unwrap().last_used = Instant::now();
                return Ok(peer);
            }
            // Config changed: drop the stale session before respawning.
            if let Some(stale) = map.remove(&key) {
                let _ = stale.svc.cancel().await;
            }
        }

        let cmd = Self::build_command(server)?;
        let transport = TokioChildProcess::new(cmd)
            .with_context(|| format!("spawning MCP server `{}`", server.id))?;
        let svc = ()
            .serve(transport)
            .await
            .with_context(|| format!("initializing MCP server `{}`", server.id))?;
        let peer = svc.peer().clone();
        map.insert(
            key,
            Session { svc, last_used: Instant::now(), fingerprint: fp },
        );
        Ok(peer)
    }

    /// List a server's tools over its (possibly new) session.
    pub async fn list_tools(
        &self,
        thread_id: &str,
        server: &ServerConfig,
    ) -> anyhow::Result<Vec<ToolDef>> {
        let peer = self.get_or_create(thread_id, server).await?;
        let tools = peer.list_all_tools().await?;
        // Reuse the existing pure mapper by going through the standard MCP JSON shape.
        let v = json!({ "tools": serde_json::to_value(&tools)? });
        Ok(super::tools_from_list_result(&v))
    }

    /// Call a tool over the session. On a transport error (dead child) the session
    /// is dropped and the call retried once.
    pub async fn call_tool(
        &self,
        thread_id: &str,
        server: &ServerConfig,
        tool: &str,
        args: &Value,
    ) -> anyhow::Result<String> {
        match self.try_call(thread_id, server, tool, args).await {
            Ok(text) => Ok(text),
            Err(_) => {
                self.close_one(thread_id, &server.id).await;
                self.try_call(thread_id, server, tool, args).await
            }
        }
    }

    async fn try_call(
        &self,
        thread_id: &str,
        server: &ServerConfig,
        tool: &str,
        args: &Value,
    ) -> anyhow::Result<String> {
        let peer = self.get_or_create(thread_id, server).await?;
        let result = peer
            .call_tool(CallToolRequestParam {
                name: Cow::Owned(tool.to_string()),
                arguments: args.as_object().cloned(),
            })
            .await?;
        let v = serde_json::to_value(&result)?;
        Ok(super::text_from_call_result(&v))
    }

    /// Cancel + remove one session.
    async fn close_one(&self, thread_id: &str, server_id: &str) {
        let removed = self
            .inner
            .lock()
            .await
            .remove(&(thread_id.to_string(), server_id.to_string()));
        if let Some(s) = removed {
            let _ = s.svc.cancel().await;
        }
    }

    /// Cancel + remove every session for a thread (called on thread delete).
    pub async fn close_thread(&self, thread_id: &str) {
        let mut map = self.inner.lock().await;
        let keys: Vec<_> = map.keys().filter(|(t, _)| t == thread_id).cloned().collect();
        let drained: Vec<_> = keys.into_iter().filter_map(|k| map.remove(&k)).collect();
        drop(map);
        for s in drained {
            let _ = s.svc.cancel().await;
        }
    }

    /// Cancel + remove every session whose server id matches (called when a server
    /// is disabled or removed in settings).
    pub async fn close_server(&self, server_id: &str) {
        let mut map = self.inner.lock().await;
        let keys: Vec<_> = map.keys().filter(|(_, s)| s == server_id).cloned().collect();
        let drained: Vec<_> = keys.into_iter().filter_map(|k| map.remove(&k)).collect();
        drop(map);
        for s in drained {
            let _ = s.svc.cancel().await;
        }
    }

    /// Cancel + remove all sessions (called on app exit).
    pub async fn close_all(&self) {
        let drained: Vec<_> = self.inner.lock().await.drain().map(|(_, s)| s).collect();
        for s in drained {
            let _ = s.svc.cancel().await;
        }
    }

    /// Cancel sessions idle for at least `max_idle` (called periodically by the reaper).
    pub async fn reap_idle(&self, max_idle: Duration) {
        let now = Instant::now();
        let mut map = self.inner.lock().await;
        let entries: Vec<((String, String), Duration)> = map
            .iter()
            .map(|(k, s)| (k.clone(), now.duration_since(s.last_used)))
            .collect();
        let drained: Vec<_> = reap_targets(&entries, max_idle)
            .into_iter()
            .filter_map(|k| map.remove(&k))
            .collect();
        drop(map);
        for s in drained {
            let _ = s.svc.cancel().await;
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: compiles. If `svc.peer()` or `list_all_tools`/`call_tool` names mismatch your resolved rmcp 1.7, check `cargo doc -p rmcp --open` — the methods exist on `Peer<RoleClient>` / `RunningService`; adjust the accessor only.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mcp/session.rs
git commit -m "feat(mcp): McpSessions registry — rmcp spawn/serve, lifecycle, reaper"
```

---

## Task 6: Mock stdio MCP server fixture + integration test

**Files:**
- Create: `src-tauri/tests/fixtures/mock_mcp_server.py`
- Modify: `src-tauri/src/mcp/session.rs` (add the `#[ignore]`d integration test)

- [ ] **Step 1: Write the mock server**

Create `src-tauri/tests/fixtures/mock_mcp_server.py`:

```python
#!/usr/bin/env python3
"""Minimal stateful stdio MCP server for tests. Exposes one tool, `increment`,
that returns a per-process running counter — so a *persisted* session returns
1, 2, 3..., while a respawn-per-call client would always get 1. JSON-RPC 2.0,
newline-framed, over stdin/stdout. Anything non-protocol goes to stderr."""
import sys
import json

counter = 0

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def main():
    global counter
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = msg.get("method")
        mid = msg.get("id")
        if mid is None:
            # A notification (e.g. notifications/initialized) — no response.
            continue
        if method == "initialize":
            params = msg.get("params", {})
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": params.get("protocolVersion", "2025-03-26"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "mock", "version": "0.1"},
            }})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [
                {"name": "increment", "description": "increment a counter",
                 "inputSchema": {"type": "object", "properties": {}}}
            ]}})
        elif method == "tools/call":
            counter += 1
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": str(counter)}],
                "isError": False,
            }})
        else:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}})

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the failing integration test**

Add to the `tests` module in `session.rs`:

```rust
    // Fully-qualified paths so the test compiles regardless of what the `use
    // super::*` glob happens to re-export.
    fn mock_cfg() -> crate::mcp::ServerConfig {
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/mock_mcp_server.py");
        crate::mcp::ServerConfig {
            id: "mock".into(),
            transport_kind: Some(crate::mcp::Transport::Stdio),
            transport_alias: None,
            command: Some(format!("python3 {script}")),
            url: None,
            enabled: true,
            search_provider: None,
            env: None,
        }
    }

    #[tokio::test]
    #[ignore = "spawns python3; run with: cargo test -- --ignored"]
    async fn session_persists_within_a_thread_and_isolates_across_threads() {
        let sessions = McpSessions::default();
        let cfg = mock_cfg();
        let args = serde_json::json!({});

        // tools/list works over the session.
        let tools = sessions.list_tools("A", &cfg).await.unwrap();
        assert!(tools.iter().any(|t| t.name == "increment"));

        // Same thread reuses the process -> counter persists (1, then 2).
        let r1 = sessions.call_tool("A", &cfg, "increment", &args).await.unwrap();
        let r2 = sessions.call_tool("A", &cfg, "increment", &args).await.unwrap();
        assert_eq!(r1.trim(), "1");
        assert_eq!(r2.trim(), "2");

        // A different thread gets its own fresh process -> resets to 1.
        let r3 = sessions.call_tool("B", &cfg, "increment", &args).await.unwrap();
        assert_eq!(r3.trim(), "1");

        sessions.close_all().await;
    }
```

(`crate::mcp::Transport` / `crate::mcp::ServerConfig` resolve the types from `mcp/mod.rs`; the
`Transport` enum must be at least `pub(crate)` — it is `pub` in `mod.rs` already.)

- [ ] **Step 3: Run the integration test**

Run: `cd src-tauri && cargo test --lib mcp::session::tests -- --ignored`
Expected: PASS — `r1=1, r2=2` proves persistence; `r3=1` proves per-thread isolation. (Requires `python3` on PATH.)

- [ ] **Step 4: Verify the default (non-ignored) suite still passes**

Run: `cd src-tauri && cargo test --lib mcp::session::tests`
Expected: PASS (the 3 pure tests; the integration test is skipped as ignored).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tests/fixtures/mock_mcp_server.py src-tauri/src/mcp/session.rs
git commit -m "test(mcp): mock stdio server + persistence/isolation integration test"
```

---

## Task 7: Route the stdio transport through `McpSessions`

**Files:**
- Modify: `src-tauri/src/mcp/mod.rs` (`list_tools`, `call_tool`, `call_tool_inner`, `mcp_list_tools`; delete old stdio helpers)

- [ ] **Step 1: Re-point `list_tools` at the session manager**

Replace the body of `list_tools` (lines 122-136) with:

```rust
pub async fn list_tools(
    client: &reqwest::Client,
    sessions: &session::McpSessions,
    thread_id: &str,
    servers: &[ServerConfig],
) -> Vec<ToolDef> {
    let mut out = Vec::new();
    for server in servers.iter().filter(|s| s.enabled) {
        let tools = match server.transport() {
            Transport::Builtin => builtin_tools(&server.id),
            Transport::Stdio => match sessions.list_tools(thread_id, server).await {
                Ok(t) => t,
                Err(e) => {
                    // Resilient in the chat path: a broken server contributes no
                    // tools rather than aborting the turn. Logged (dev-visible);
                    // the settings refresh surfaces it to the user (mcp_list_tools).
                    eprintln!("MCP server `{}` failed to start: {e:#}", server.id);
                    Vec::new()
                }
            },
            Transport::Http => list_http_tools(client, server).await.unwrap_or_default(),
        };
        for mut t in tools {
            t.name = namespaced(&server.id, &t.name);
            out.push(t);
        }
    }
    out
}
```

- [ ] **Step 2: Thread the manager through `call_tool` / `call_tool_inner`**

Change `call_tool`'s signature (line 141-146) to add the two params and forward them:

```rust
pub async fn call_tool(
    client: &reqwest::Client,
    sessions: &session::McpSessions,
    thread_id: &str,
    servers: &[ServerConfig],
    call: &ToolCall,
    on_delta: &Channel<StreamDelta>,
) -> String {
```

Inside it, the `call_tool_inner(...)` invocation (line 161) becomes:

```rust
    match call_tool_inner(client, sessions, thread_id, servers, call, &emit, &emit_images, &emit_sources).await {
```

Change `call_tool_inner`'s signature (line 167-174) to add `sessions: &session::McpSessions, thread_id: &str` after `client`, and replace its `Transport::Stdio` arm (line 199) with:

```rust
        Transport::Stdio => sessions.call_tool(thread_id, server, tool, &call.arguments).await,
```

- [ ] **Step 3: Delete the dead hand-rolled stdio path**

Remove from `mod.rs`: `split_command` (lines 319-326), and the entire `// stdio transport` section — `stdio_roundtrip`, `list_stdio_tools`, `call_stdio_tool` (lines 328-427). The `rpc_request`/`parse_rpc_result`/`parse_http_body` helpers stay (HTTP still uses them).

- [ ] **Step 4: Update the `mcp_list_tools` command to report per-server errors**

The chat path stays resilient (swallow+log), but the **settings refresh** should tell the user
*why* a server lists no tools. Add a report type and rewrite the command to iterate servers itself,
capturing each server's error. Add near `ListedTool` (line 511):

```rust
/// A server that failed to list its tools (settings refresh surfaces this).
#[derive(Debug, Serialize)]
pub struct ServerToolError {
    pub server_id: String,
    pub message: String,
}

/// Result of a settings "refresh tools": the tools that listed, plus per-server
/// errors for those that failed to start/handshake.
#[derive(Debug, Serialize)]
pub struct ListToolsReport {
    pub tools: Vec<ListedTool>,
    pub errors: Vec<ServerToolError>,
}
```

Replace `mcp_list_tools` (lines 521-536) with (uses a throwaway settings key it closes after, so a
refresh never leaks a long-lived process):

```rust
#[tauri::command]
pub async fn mcp_list_tools(
    servers: Vec<ServerConfig>,
    sessions: tauri::State<'_, session::McpSessions>,
) -> Result<ListToolsReport, String> {
    let client = reqwest::Client::new();
    let mut tools = Vec::new();
    let mut errors = Vec::new();
    for server in servers.iter().filter(|s| s.enabled) {
        let res: anyhow::Result<Vec<ToolDef>> = match server.transport() {
            Transport::Builtin => Ok(builtin_tools(&server.id)),
            Transport::Stdio => sessions.list_tools("__settings__", server).await,
            Transport::Http => list_http_tools(&client, server).await,
        };
        match res {
            Ok(defs) => {
                for d in defs {
                    tools.push(ListedTool {
                        server_id: server.id.clone(),
                        name: d.name,
                        description: d.description,
                    });
                }
            }
            Err(e) => errors.push(ServerToolError {
                server_id: server.id.clone(),
                message: format!("{e:#}"),
            }),
        }
    }
    sessions.close_thread("__settings__").await;
    Ok(ListToolsReport { tools, errors })
}
```

(`list_http_tools` returns `anyhow::Result<Vec<ToolDef>>` already; `builtin_tools` is infallible.
Tool names here are NOT namespaced — the settings UI renders `server_id__name` itself, matching
today's behavior.)

- [ ] **Step 5: Build (chat.rs callers will still be broken — that's Task 8)**

Run: `cd src-tauri && cargo build 2>&1 | grep -A2 "chat.rs" | head`
Expected: the ONLY remaining errors point at `commands/chat.rs` (wrong arg count to `list_tools`/`call_tool`). `mcp/mod.rs` itself compiles. If `mod.rs` has its own errors, fix them before moving on.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp/mod.rs
git commit -m "refactor(mcp): route stdio through McpSessions; drop spawn-per-call path"
```

---

## Task 8: Wire `chat_stream` + lib.rs (state, reaper, commands, exit)

**Files:**
- Modify: `src-tauri/src/commands/chat.rs:79-117, 201`
- Modify: `src-tauri/src/lib.rs:194-196, 213-262, 278-311`
- Modify: `src-tauri/src/mcp/mod.rs` (add the `mcp_close_thread_sessions` command)

- [ ] **Step 1: Add the close-thread command to `mcp/mod.rs`**

Add near `mcp_list_tools` in `mod.rs`:

```rust
/// Close every live session for a thread (called by the frontend when a thread is
/// deleted, so its stdio servers — e.g. a headless browser — shut down promptly).
#[tauri::command]
pub async fn mcp_close_thread_sessions(
    thread_id: String,
    sessions: tauri::State<'_, session::McpSessions>,
) -> Result<(), String> {
    sessions.close_thread(&thread_id).await;
    Ok(())
}

/// Close every live session for a server id across all threads (called when a
/// server is disabled, edited, or removed in settings).
#[tauri::command]
pub async fn mcp_close_server_sessions(
    server_id: String,
    sessions: tauri::State<'_, session::McpSessions>,
) -> Result<(), String> {
    sessions.close_server(&server_id).await;
    Ok(())
}
```

- [ ] **Step 2: Update `chat_stream` to accept the thread id + sessions state**

In `chat.rs`, add two params to `chat_stream` (after `mcpServers`, ~line 85):

```rust
    #[allow(non_snake_case)] threadId: String,
    sessions: State<'_, crate::mcp::session::McpSessions>,
```

Replace the tool-list build (lines 112-117) with:

```rust
    let servers = mcpServers.unwrap_or_default();
    let tools = if servers.is_empty() {
        Vec::new()
    } else {
        mcp::list_tools(&client, sessions.inner(), &threadId, &servers).await
    };
```

Replace the `call_tool` invocation (line 201) with:

```rust
            let content =
                mcp::call_tool(&client, sessions.inner(), &threadId, &servers, call, &on_delta).await;
```

- [ ] **Step 3: Register state, reaper, commands, and exit teardown in `lib.rs`**

Add the managed state next to the others (after line 196):

```rust
        .manage(mcp::session::McpSessions::default())
```

In `setup()` (after `menu::install(app)?;`, ~line 227) spawn the idle reaper:

```rust
            // Reap idle external-stdio MCP sessions (e.g. a lingering headless
            // browser) ~every minute; 10-minute idle window.
            {
                let sessions = app.state::<mcp::session::McpSessions>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                        sessions.reap_idle(std::time::Duration::from_secs(600)).await;
                    }
                });
            }
```

In the `invoke_handler!` list (after `mcp::mcp_list_tools,` at line 308) add:

```rust
            mcp::mcp_close_thread_sessions,
            mcp::mcp_close_server_sessions,
```

Replace the final `.run(tauri::generate_context!()).expect(...)` (lines 310-311) with a build+run that closes all sessions on exit:

```rust
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let sessions = app_handle.state::<mcp::session::McpSessions>().inner().clone();
                tauri::async_runtime::block_on(sessions.close_all());
            }
        });
```

Confirm `use tauri::Manager;` (or the trait providing `.state()`) is in scope in `lib.rs`; it's already used for `get_webview_window`, so `.state()` resolves.

- [ ] **Step 4: Build the whole backend**

Run: `cd src-tauri && cargo build`
Expected: compiles cleanly.

- [ ] **Step 5: Run clippy + the full Rust test suite**

Run: `cd src-tauri && cargo clippy --all-targets 2>&1 | tail -5 && cargo test --lib mcp`
Expected: no clippy errors; all (non-ignored) mcp tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/chat.rs src-tauri/src/lib.rs src-tauri/src/mcp/mod.rs
git commit -m "feat(mcp): wire per-thread sessions into chat_stream + lifecycle in lib.rs"
```

---

## Task 9: Frontend — env type, helpers, threadId plumbing, close-on-delete

**Files:**
- Modify: `src/lib/mcp.ts` (`McpServer.env`, `parseEnvText`, `formatEnvText`, `mcpCloseThreadSessions`)
- Modify: `src/lib/mcp.test.ts`
- Modify: `src/lib/chat.ts` (`chatStream` gains `threadId`)
- Modify: `src/store/threads.ts` (3 call sites + `remove`)

- [ ] **Step 1: Write failing tests for the env helpers**

Add to `src/lib/mcp.test.ts`:

```ts
import { parseEnvText, formatEnvText } from "@/lib/mcp";

describe("env text helpers", () => {
  it("parses KEY=value lines, ignoring blanks and comments", () => {
    expect(parseEnvText("A=1\nB=two words\n\n# a comment\nNOEQUALS")).toEqual({
      A: "1",
      B: "two words",
    });
  });

  it("trims the key and keeps everything after the first = as the value", () => {
    expect(parseEnvText("  TOKEN = ab=cd ")).toEqual({ TOKEN: "ab=cd" });
  });

  it("formats a record back to sorted KEY=value lines", () => {
    expect(formatEnvText({ B: "2", A: "1" })).toBe("A=1\nB=2");
  });

  it("round-trips through parseServers via the env field", () => {
    const json = JSON.stringify([
      { id: "fx", label: "FF", transport: "stdio", command: "npx -y fx", enabled: true, env: { A: "1" } },
    ]);
    const out = parseServers(json).find((s) => s.id === "fx");
    expect(out?.env).toEqual({ A: "1" });
  });
});
```

(Add `parseServers` to the existing import from `@/lib/mcp` if it isn't already imported.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/mcp.test.ts`
Expected: FAIL — `parseEnvText`/`formatEnvText` are not exported.

- [ ] **Step 3: Add the `env` field + helpers**

In `src/lib/mcp.ts`, add to the `McpServer` interface (after `search_provider`, ~line 47):

```ts
  /** For stdio servers: environment variables for the child process. */
  env?: Record<string, string>;
```

Add these pure helpers near the bottom of `src/lib/mcp.ts` (before `listTools`):

```ts
/** Parse a textarea of `KEY=value` lines into an env record. Blank lines and
 * lines starting with `#` are ignored; the value is everything after the first
 * `=`. Keys are trimmed. Pure — unit-tested. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key) out[key] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** Render an env record as sorted `KEY=value` lines (for the settings textarea). */
export function formatEnvText(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** Close every live MCP session for a thread (call when a thread is deleted). */
export function mcpCloseThreadSessions(threadId: string): Promise<void> {
  return invoke("mcp_close_thread_sessions", { threadId });
}

/** Close every live MCP session for a server id across threads (call when a
 * server is disabled, edited, or removed in settings). */
export function mcpCloseServerSessions(serverId: string): Promise<void> {
  return invoke("mcp_close_server_sessions", { serverId });
}
```

(The `listTools` return-type change + report types land in Task 10, atomically with their only
consumer `McpServers.tsx`, so this task's build stays green. Until then `listTools` still types as
`Promise<McpListedTool[]>`; the settings refresh's runtime shape is reconciled in Task 10.)

- [ ] **Step 4: Run to verify the helpers pass**

Run: `npm test -- src/lib/mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `threadId` to `chatStream`**

In `src/lib/chat.ts`, change the `chatStream` signature (line 139-144) to add a final param and pass it through:

```ts
export async function chatStream(
  provider: Provider,
  model: string,
  messages: ApiMessage[],
  onDelta: (event: StreamEvent) => void,
  threadId: string,
): Promise<ChatResult> {
```

and in the `invoke("chat_stream", {...})` object (line 155-161) add `threadId`:

```ts
  return invoke("chat_stream", {
    provider,
    model,
    messages,
    onDelta: channel,
    mcpServers,
    threadId,
  });
```

- [ ] **Step 6: Pass the thread id at all 3 call sites in `threads.ts`**

- `send` (call at line 861): add `threadId` as the 5th arg (the var `threadId` is defined at line 717):

```ts
        const result = await chatStream(
          replyProvider,
          replyModel,
          history,
          onDelta,
          threadId,
        );
```

- `regenerate` (call at line 1179): the thread id var here is `id` (line 1029):

```ts
      const result = await chatStream(
        replyProvider,
        replyModel,
        history,
        onDelta,
        id,
      );
```

- `compact` (call at line 1273): the thread id var here is `id` (line 1262):

```ts
      const result = await chatStream(
        thread.provider,
        thread.model,
        request,
        () => {},
        id,
      );
```

- [ ] **Step 7: Close sessions when a thread is deleted**

In `src/store/threads.ts`, import the helper — add `mcpCloseThreadSessions` to the existing `@/lib/mcp` import (or add a new import line). Then in `remove` (line 1369-1380), after `await deleteThread(id);` add:

```ts
    await mcpCloseThreadSessions(id);
```

- [ ] **Step 7b: Fix the 4th caller (personaMemory) + the call-args test**

`chatStream` now requires a `threadId`. The non-thread bot-memory call in `src/lib/personaMemory.ts`
(line 193) must pass one — use a stable synthetic id (these short summarization calls aren't a chat
thread; a constant key means they share one session per server, reaped when idle):

```ts
    const result = await chatStream(provider, model, messages, () => {}, "__persona__");
```

In `src/store/threads.mentions.test.ts`, the assertion at line 239 lists `chatStream`'s args
exactly and must gain the new 5th arg:

```ts
    expect(chatStream).toHaveBeenCalledWith(
      "anthropic",
      "m",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
```

(The other `chatStream` mocks in `threads.mentions.test.ts` / `threads.bots.test.ts` read
`.mock.calls[0][2]` (the unchanged messages arg) or assert call counts, so they need no change.)

- [ ] **Step 8: Typecheck + full frontend test run**

Run: `npm run build && npm test -- src/lib/mcp.test.ts src/store/threads.mentions.test.ts src/store/threads.bots.test.ts`
Expected: `tsc` passes (all 4 `chatStream` callers now type-check with the new arg); tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/mcp.ts src/lib/mcp.test.ts src/lib/chat.ts src/store/threads.ts src/lib/personaMemory.ts src/store/threads.mentions.test.ts
git commit -m "feat(mcp): frontend env type + helpers, threadId plumbing, close-on-delete"
```

---

## Task 10: Settings UI — env field, edit, error surface

**Files:**
- Modify: `src/lib/mcp.ts` (report types + `listTools` return type)
- Modify: `src/components/settings/McpServers.tsx`
- Modify: `src/lib/i18n.ts` (new inline strings)

- [ ] **Step 0: Change `listTools` to return the `{ tools, errors }` report**

In `src/lib/mcp.ts`, add the report types near `McpListedTool` (line 71):

```ts
/** A server that failed to list its tools, surfaced in settings. Mirrors the
 * Rust `ServerToolError`. */
export interface McpServerToolError {
  server_id: string;
  message: string;
}

/** Result of a settings tool refresh: listed tools + per-server errors. */
export interface McpToolsReport {
  tools: McpListedTool[];
  errors: McpServerToolError[];
}
```

And change `listTools` (line 248-251) from `Promise<McpListedTool[]>` to:

```ts
/** List the tools the given servers expose, plus per-server errors (settings
 * "refresh/test"). */
export function listTools(servers: McpServer[]): Promise<McpToolsReport> {
  return invoke("mcp_list_tools", { servers });
}
```

(This breaks `McpServers.tsx` until Step 3 updates the consumer — both land in this one commit.)

- [ ] **Step 1: Add env entry to the "add custom server" form (stdio only)**

In `McpServers.tsx`, add a draft env state near the other draft state (line 48-51):

```tsx
  const [draftEnv, setDraftEnv] = useState("");
```

Import the helpers (extend the `@/lib/mcp` import, lines 13-27):

```tsx
  parseEnvText,
  formatEnvText,
  mcpCloseServerSessions,
  type McpServerToolError,
```

In `addCustom` (lines 118-142), build env for stdio servers. Replace the `server` object (lines 132-138) with:

```tsx
    const env = draftTransport === "stdio" ? parseEnvText(draftEnv) : {};
    const server: McpServer = {
      id,
      label,
      transport: draftTransport,
      enabled: true,
      ...(draftTransport === "http" ? { url: target } : { command: target }),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
```

and reset it after add (after `setDraftTarget("")`, line 141):

```tsx
    setDraftEnv("");
```

In the add-form JSX, after the transport/target row (after line 334, before the Add button) add an env textarea shown only for stdio:

```tsx
          {draftTransport === "stdio" && (
            <textarea
              className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:ring-ring rounded-md border px-3 py-2 font-mono text-xs focus-visible:ring-1 focus-visible:outline-none"
              rows={2}
              placeholder={t("mcp.envPlaceholder")}
              value={draftEnv}
              onChange={(e) => setDraftEnv(e.target.value)}
            />
          )}
```

- [ ] **Step 2: Add inline editing for custom servers**

Add edit state near the draft state:

```tsx
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState("");
  const [editEnv, setEditEnv] = useState("");
```

Add helpers (near `remove`, line 114-116):

```tsx
  function beginEdit(s: McpServer) {
    setEditingId(s.id);
    setEditTarget(s.command ?? s.url ?? "");
    setEditEnv(formatEnvText(s.env));
  }

  function saveEdit(s: McpServer) {
    const target = editTarget.trim();
    if (!target) return;
    const env = s.transport === "stdio" ? parseEnvText(editEnv) : {};
    void persist(
      servers.map((x) =>
        x.id === s.id
          ? {
              ...x,
              ...(s.transport === "http" ? { url: target } : { command: target }),
              env: Object.keys(env).length > 0 ? env : undefined,
            }
          : x,
      ),
    );
    setEditingId(null);
  }
```

In the per-server row, for non-builtin servers add an **Edit** button next to **Remove** (inside the `{!s.builtin && (...)}` block, line 199-215 — wrap the existing Remove button and the new Edit button in the same flex container):

```tsx
                  {!s.builtin && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => (editingId === s.id ? setEditingId(null) : beginEdit(s))}
                      >
                        {editingId === s.id ? t("common.cancel") : t("common.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void confirmDialog({
                            title: tNow("mcp.removeTitle", { label: s.label }),
                            confirmText: tNow("common.remove"),
                            destructive: true,
                          }).then((ok) => {
                            if (ok) remove(s.id);
                          });
                        }}
                      >
                        {t("common.remove")}
                      </Button>
                    </>
                  )}
```

After the row's detail block (after the `s.command || s.url` span, ~line 186) add the edit panel:

```tsx
                  {editingId === s.id && (
                    <div className="mt-2 flex flex-col gap-2">
                      <Input
                        value={editTarget}
                        onChange={(e) => setEditTarget(e.target.value)}
                        placeholder={s.transport === "http" ? "https://server/mcp" : "command --arg"}
                      />
                      {s.transport === "stdio" && (
                        <textarea
                          className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:ring-ring rounded-md border px-3 py-2 font-mono text-xs focus-visible:ring-1 focus-visible:outline-none"
                          rows={2}
                          placeholder={t("mcp.envPlaceholder")}
                          value={editEnv}
                          onChange={(e) => setEditEnv(e.target.value)}
                        />
                      )}
                      <Button size="sm" variant="secondary" className="self-start" onClick={() => saveEdit(s)}>
                        {t("common.save")}
                      </Button>
                    </div>
                  )}
```

- [ ] **Step 2b: Close a server's live sessions when it's disabled, edited, or removed**

In `toggle` (lines 108-112), close sessions when turning a server **off** (so e.g. a headless
browser shuts down instead of idling). Replace it with:

```tsx
  function toggle(id: string) {
    const next = servers.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s,
    );
    const nowEnabled = next.find((s) => s.id === id)?.enabled;
    if (nowEnabled === false) void mcpCloseServerSessions(id);
    void persist(next);
  }
```

In `remove` (lines 114-116), close the removed server's sessions:

```tsx
  function remove(id: string) {
    void mcpCloseServerSessions(id);
    void persist(servers.filter((s) => s.id !== id));
  }
```

In `saveEdit` (added in Step 2), close the edited server's sessions so the next call respawns with
the new command/env promptly. Add as the first line of `saveEdit`, after the `target` guard:

```tsx
    void mcpCloseServerSessions(s.id);
```

- [ ] **Step 3: Surface per-server spawn errors on refresh**

`listTools` now returns `{ tools, errors }`. Add an errors state near the other state (line 41-46):

```tsx
  const [serverErrors, setServerErrors] = useState<McpServerToolError[]>([]);
```

Replace `refreshTools` (lines 144-154) to consume the report:

```tsx
  async function refreshTools() {
    setLoading(true);
    setError(null);
    try {
      const report = await listTools(servers.filter((s) => s.enabled));
      setTools(report.tools);
      setServerErrors(report.errors);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
```

Render the per-server errors above the tools list. After the `availableTools` header block and
before the tools `<ul>` (around line 358), add:

```tsx
          {serverErrors.length > 0 && (
            <ul className="flex flex-col gap-1">
              {serverErrors.map((e) => (
                <li key={e.server_id} className="text-destructive text-xs break-all">
                  <code>{e.server_id}</code>: {e.message}
                </li>
              ))}
            </ul>
          )}
```

- [ ] **Step 4: Add i18n strings**

The canonical English strings AND the `MessageKey` type live inline in `src/lib/i18n.ts` as a flat
dot-key object (`src/locales/en.json` is an empty pack: `"strings": {}`; the `da/de/es/fr/pl` JSONs
are override packs that fall back to English for missing keys). So **adding keys to `i18n.ts` is
required** (it extends `MessageKey`, so `tsc` accepts the new `t(...)` calls); locale-pack
translations are optional polish that can come later.

`common.save`, `common.cancel`, `common.remove` already exist (i18n.ts lines 31, 32, 35). `common.edit`
does **not** — add it. In `src/lib/i18n.ts`, in the `common.*` group (near line 31) add:

```ts
  "common.edit": "Edit",
```

In the `mcp.*` group (near line 556) add:

```ts
  "mcp.envPlaceholder": "Environment variables, one KEY=value per line (e.g. START_URL=about:blank)",
```

No changes to the locale JSON packs are needed for functionality (they fall back to the English
strings above). Optionally add `"mcp.envPlaceholder"` / `"common.edit"` translations to
`src/locales/{da,de,es,fr,pl}.json` under their `strings` object as a follow-up.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: `tsc` and ESLint pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp.ts src/components/settings/McpServers.tsx src/lib/i18n.ts
git commit -m "feat(mcp): settings UI — env vars, edit servers, per-server errors, session teardown"
```

---

## Task 11: Full verification + manual E2E against firefox-devtools-mcp

**Files:** none (verification only)

- [ ] **Step 1: Full automated suite**

Run:
```bash
cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -5 && cargo fmt --check
cd .. && npm test && npm run build && npm run lint
```
Expected: all green. (The `#[ignore]`d session integration test is skipped; optionally run it with `cd src-tauri && cargo test --lib mcp::session -- --ignored` if `python3` is available.)

- [ ] **Step 2: Manual E2E — persistence across messages**

Run: `npm run tauri dev`. In Settings → MCP, add a custom **stdio** server: label `Firefox`, command `npx -y @mozilla/firefox-devtools-mcp@latest --headless`, env `START_URL=about:blank`. Click **Refresh** under "Available tools" — confirm firefox tools appear (this also proves spawn+handshake). Then in one thread: message 1 "navigate to example.com", message 2 "what's the page title?". Expected: message 2 answers using state from message 1 (the browser stayed open). Confirm only one Firefox process is running (`pgrep -fa firefox` / Activity Monitor).

- [ ] **Step 3: Manual E2E — isolation + teardown**

Start a *second* thread and confirm it gets its own session (a separate Firefox process, fresh state). Delete the first thread and confirm its Firefox process exits promptly (the `mcp_close_thread_sessions` call). Leave a thread idle > 10 min (or temporarily lower the reaper window to test) and confirm the idle session's process exits. Quit the app and confirm no orphaned Firefox processes remain.

- [ ] **Step 4: Regression — no-MCP path unchanged**

With all custom servers disabled and only built-ins, confirm normal chat + the built-in `web`/`youtube`/`sys` tools behave exactly as before (the builtin/http arms were untouched).

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(mcp): verification pass for stateful per-thread sessions"
```
```

---

## Notes for the implementer

- **rmcp API drift:** the surface used here (`().serve(transport)`, `TokioChildProcess::new`, `ConfigureCommandExt::configure`, `Peer::list_all_tools`/`call_tool`, `RunningService::peer`/`cancel`, `CallToolRequestParam`) is from rmcp 1.7. If a name differs after `cargo update`, run `cargo doc -p rmcp --open` and adjust the accessor — the shapes are stable.
- **Result mapping reuse:** `list_tools`/`call_tool` deliberately serialize rmcp's `ListToolsResult`/`CallToolResult` to `serde_json::Value` and reuse the existing pure `tools_from_list_result`/`text_from_call_result` mappers, so we don't depend on rmcp's exact content accessors and keep one tested mapping path.
- **Scope:** external HTTP servers keep today's stateless POST; built-in servers are untouched. Streamable-HTTP sessions, a structured args array, and per-server idle config are deferred (see spec).
