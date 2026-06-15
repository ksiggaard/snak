//! External-stdio MCP sessions via the `rmcp` SDK.
//!
//! Each enabled external **stdio** server is kept alive as a persistent child
//! process, scoped per chat thread. `rmcp`'s `RunningService` is the session: it
//! runs the initialize/initialized handshake once and correlates request ids, so
//! many `tools/call`s reuse one process and the server keeps its state across a
//! thread's messages. Sessions are torn down on idle, thread deletion, config
//! change, and app exit. Built-in and HTTP servers do NOT use this module.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context};
use rmcp::model::CallToolRequestParams;
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

/// Keys whose idle time is at least `max_idle`. Pure, so it is unit-tested.
fn reap_targets<K: Clone>(entries: &[(K, Duration)], max_idle: Duration) -> Vec<K> {
    entries
        .iter()
        .filter(|(_, idle)| *idle >= max_idle)
        .map(|(k, _)| k.clone())
        .collect()
}

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
    /// returned `Peer` is then used WITHOUT the lock (calls can be slow). Note this
    /// also briefly blocks lookups of already-live sessions while another key is
    /// spawning — acceptable given the single-active-chat usage of this app.
    async fn get_or_create(
        &self,
        thread_id: &str,
        server: &ServerConfig,
    ) -> anyhow::Result<Peer<RoleClient>> {
        let key = (thread_id.to_string(), server.id.clone());
        let fp = server.fingerprint();
        let mut map = self.inner.lock().await;

        if let Some(existing) = map.get_mut(&key) {
            if existing.fingerprint == fp {
                existing.last_used = Instant::now();
                return Ok(existing.svc.peer().clone());
            }
            // Fingerprint mismatch (config edited): drop the stale session.
        }
        if let Some(stale) = map.remove(&key) {
            let _ = stale.svc.cancel().await;
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
            Session {
                svc,
                last_used: Instant::now(),
                fingerprint: fp,
            },
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
        let v = json!({ "tools": serde_json::to_value(&tools)? });
        Ok(super::tools_from_list_result(&v))
    }

    /// Call a tool over the session. On error (e.g. a dead child) the session is
    /// dropped and the call retried once. MCP *tool-level* errors come back as an
    /// `Ok` result with `isError: true`, so they don't trigger the respawn — only
    /// transport/protocol failures do. The first error is preserved in the retry's
    /// context so a double failure stays debuggable.
    pub async fn call_tool(
        &self,
        thread_id: &str,
        server: &ServerConfig,
        tool: &str,
        args: &Value,
    ) -> anyhow::Result<String> {
        match self.try_call(thread_id, server, tool, args).await {
            Ok(text) => Ok(text),
            Err(first) => {
                self.close_one(thread_id, &server.id).await;
                self.try_call(thread_id, server, tool, args)
                    .await
                    .with_context(|| format!("after respawn+retry (first error: {first:#})"))
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
        let mut params = CallToolRequestParams::new(tool.to_string());
        params.arguments = args.as_object().cloned();
        let result = peer.call_tool(params).await?;
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
        let keys: Vec<_> = map
            .keys()
            .filter(|(t, _)| t == thread_id)
            .cloned()
            .collect();
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
        let keys: Vec<_> = map
            .keys()
            .filter(|(_, s)| s == server_id)
            .cloned()
            .collect();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_program_and_args() {
        let (prog, args) =
            parse_command("npx -y @mozilla/firefox-devtools-mcp@latest --headless").unwrap();
        assert_eq!(prog, "npx");
        assert_eq!(
            args,
            ["-y", "@mozilla/firefox-devtools-mcp@latest", "--headless"]
        );
    }

    #[test]
    fn empty_command_errors() {
        assert!(parse_command("   ").is_err());
    }

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
}
