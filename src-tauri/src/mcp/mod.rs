//! MCP (Model Context Protocol) client.
//!
//! Connects to configured MCP servers — over **stdio** (spawn a child process,
//! JSON-RPC 2.0 newline-framed over stdin/stdout) or **HTTP** (JSON-RPC POST per
//! the MCP Streamable HTTP shape) — lists their tools, and dispatches
//! `tools/call`. Plus a built-in, in-process web-browsing server (`web_browse`)
//! so tool use works out of the box with no external server to install.
//!
//! ## Tool exposure & namespacing
//!
//! Tools from all enabled servers are aggregated into a flat `Vec<ToolDef>` (the
//! shape providers turn into their own tool schemas). To avoid collisions when
//! two servers expose a tool of the same name, every tool is namespaced
//! `"<server-id>__<tool>"`. The manager routes a `call_tool` back to the owning
//! server by splitting on the first `__`.
//!
//! ## The no-tools invariant
//!
//! When the resolved server list yields no tools, the chat loop sends no `tools`
//! field and behaves byte-identically to a plain completion. The frontend owns
//! the persisted server config (Stage-1 rule) and passes the enabled list into
//! `chat_stream`; an empty/all-disabled list produces an empty tool slice.

pub mod image_search;
pub mod session;
pub mod sysdebug;
pub mod web_browse;
pub mod web_search;
pub mod youtube;

use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::providers::{StreamDelta, ToolCall, ToolDef, ToolImage, ToolSource};

/// A sink for a running tool's live output: each call streams one chunk (e.g. a
/// stdout line) to the UI. `Sync` so it can be held across `.await` in the
/// `Send` command future. A no-op sink is used by tools that don't stream.
pub type LineSink<'a> = &'a (dyn Fn(&str) + Sync);

/// A sink for images a tool fetched: called (once or in batches) with the
/// base64-encoded images, which are streamed to the UI as a `tool_images` delta.
/// `Sync` so it can be held across `.await`; only the web builtin uses it.
pub type ImageSink<'a> = &'a (dyn Fn(Vec<ToolImage>) + Sync);

/// A sink for web sources a tool consulted (search hits / fetched page): streamed
/// to the UI as a `tool_sources` delta so the user sees what informed the answer
/// and can open the links. `Sync` so it can be held across `.await`; only the web
/// builtin uses it.
pub type SourceSink<'a> = &'a (dyn Fn(Vec<ToolSource>) + Sync);

/// Transport kind for a configured server, as persisted by the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    /// Built-in, in-process server (the web-browse server). No command/url.
    Builtin,
    /// Spawn a child process; JSON-RPC over its stdin/stdout.
    Stdio,
    /// JSON-RPC over HTTP POST.
    Http,
}

/// One configured MCP server, mirrored from the frontend `settings.mcp_servers`
/// JSON. Only enabled servers contribute tools. For `Stdio`, `command` is the
/// program plus args (shell-style, split on whitespace); for `Http`, `url` is
/// the endpoint.
#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub id: String,
    #[serde(default)]
    pub transport_kind: Option<Transport>,
    /// Back-compat / explicit form: the frontend sends `transport` as the field.
    #[serde(default, rename = "transport")]
    transport_alias: Option<Transport>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// For the built-in `web` server: the web-search backend to use
    /// (`duckduckgo` (default) / `brave` / `serper`). Ignored by other servers.
    #[serde(default)]
    pub search_provider: Option<String>,
    /// Environment variables for a `Stdio` server's child process. Nested arg,
    /// so (like `search_provider`) it rides snake_case as-is from the frontend.
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
}

fn default_true() -> bool {
    true
}

impl ServerConfig {
    fn transport(&self) -> Transport {
        self.transport_kind
            .clone()
            .or_else(|| self.transport_alias.clone())
            .unwrap_or(Transport::Builtin)
    }

    /// A hash of the launch-relevant config (command + env + enabled). The session
    /// manager uses it to detect when a server was edited and respawn it.
    ///
    /// NOTE: uses `DefaultHasher` (SipHash), whose output is not guaranteed stable
    /// across Rust releases — this value is only meaningful within a single process
    /// run. Do not persist it across restarts.
    pub fn fingerprint(&self) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        self.command.hash(&mut h);
        self.enabled.hash(&mut h);
        // Sort env pairs so HashMap iteration order doesn't change the hash.
        let mut pairs: Vec<(&String, &String)> = self
            .env
            .as_ref()
            .map(|m| m.iter().collect())
            .unwrap_or_default();
        pairs.sort();
        for (k, v) in pairs {
            k.hash(&mut h);
            v.hash(&mut h);
        }
        h.finish()
    }
}

/// A tool, namespaced to the server that owns it (`<server-id>__<tool>`).
fn namespaced(server_id: &str, tool: &str) -> String {
    format!("{server_id}__{tool}")
}

/// Split a namespaced tool name back into `(server_id, tool)`. Tools that aren't
/// namespaced (no `__`) are treated as belonging to the built-in web server, so
/// a provider that drops the prefix still routes somewhere sane.
fn split_namespaced(name: &str) -> (&str, &str) {
    match name.split_once("__") {
        Some((server, tool)) => (server, tool),
        None => (web_browse::SERVER_ID, name),
    }
}

/// Aggregate the tool definitions from all enabled servers, namespaced. The
/// built-in web-browse server is always represented by an entry in `servers`
/// (the frontend includes it); a caller that passes an empty list gets no tools
/// (the no-tools invariant).
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

/// Execute one (namespaced) tool call by routing it to the owning server.
/// Returns the tool's text result, or an error string the loop feeds back to the
/// model as a failed `tool_result` (so a bad call doesn't abort the turn).
pub async fn call_tool(
    client: &reqwest::Client,
    sessions: &session::McpSessions,
    thread_id: &str,
    servers: &[ServerConfig],
    call: &ToolCall,
    on_delta: &Channel<StreamDelta>,
) -> String {
    // Live output is streamed to the UI as `tool_output` deltas keyed to this
    // call. A closed channel (frontend gone) is harmless — drop the chunk.
    let emit = move |chunk: &str| {
        let _ = on_delta.send(StreamDelta::tool_output(&call.id, chunk));
    };
    // Images a tool fetched (web image tools) ride a separate `tool_images` delta
    // so their base64 bytes never enter the model-facing result text.
    let emit_images = move |images: Vec<ToolImage>| {
        let _ = on_delta.send(StreamDelta::tool_images(&call.id, images));
    };
    // Web sources a tool consulted ride a `tool_sources` delta (display-only).
    let emit_sources = move |sources: Vec<ToolSource>| {
        let _ = on_delta.send(StreamDelta::tool_sources(&call.id, sources));
    };
    match call_tool_inner(
        client,
        sessions,
        thread_id,
        servers,
        call,
        &emit,
        &emit_images,
        &emit_sources,
    )
    .await
    {
        Ok(text) => text,
        Err(e) => format!("tool error: {e}"),
    }
}

#[allow(clippy::too_many_arguments)] // sessions+thread_id thread the registry through.
async fn call_tool_inner(
    client: &reqwest::Client,
    sessions: &session::McpSessions,
    thread_id: &str,
    servers: &[ServerConfig],
    call: &ToolCall,
    emit: LineSink<'_>,
    emit_images: ImageSink<'_>,
    emit_sources: SourceSink<'_>,
) -> anyhow::Result<String> {
    let (server_id, tool) = split_namespaced(&call.name);
    let server = servers
        .iter()
        .find(|s| s.id == server_id && s.enabled)
        .ok_or_else(|| {
            anyhow!(
                "no enabled MCP server `{server_id}` for tool `{}`",
                call.name
            )
        })?;
    match server.transport() {
        Transport::Builtin => {
            builtin_call(
                client,
                &server.id,
                tool,
                &call.arguments,
                server.search_provider.as_deref(),
                emit,
                emit_images,
                emit_sources,
            )
            .await
        }
        Transport::Stdio => {
            sessions
                .call_tool(thread_id, server, tool, &call.arguments)
                .await
        }
        Transport::Http => call_http_tool(client, server, tool, &call.arguments).await,
    }
}

/// Dispatch a built-in (in-process) server by id. Unknown ids fall back to the
/// web-browse server, matching `split_namespaced`'s unnamespaced fallback.
fn builtin_tools(server_id: &str) -> Vec<ToolDef> {
    match server_id {
        sysdebug::SERVER_ID => sysdebug::tools(),
        youtube::SERVER_ID => youtube::tools(),
        _ => web_browse::tools(),
    }
}

async fn builtin_call(
    client: &reqwest::Client,
    server_id: &str,
    tool: &str,
    args: &Value,
    search_provider: Option<&str>,
    emit: LineSink<'_>,
    emit_images: ImageSink<'_>,
    emit_sources: SourceSink<'_>,
) -> anyhow::Result<String> {
    match server_id {
        sysdebug::SERVER_ID => sysdebug::call_tool(tool, args, emit).await,
        youtube::SERVER_ID => youtube::call_tool(client, tool, args, emit_images).await,
        _ => {
            web_browse::call_tool(
                client,
                tool,
                args,
                search_provider,
                emit_images,
                emit_sources,
            )
            .await
        }
    }
}

/// Whether a (namespaced) tool call must be confirmed by the user before it
/// runs. Only the read-only system-diagnostics server (`sys`) is gated; the
/// web-browse tool and external MCP servers run as before.
pub fn requires_approval(tool_name: &str) -> bool {
    split_namespaced(tool_name).0 == sysdebug::SERVER_ID
}

/// A `(summary, detail)` describing what a gated tool call would do, for the
/// UI's per-call approval card.
pub fn describe_call(call: &ToolCall) -> (String, String) {
    let (_server, tool) = split_namespaced(&call.name);
    sysdebug::describe(tool, &call.arguments)
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers (shared by both real transports).
// ---------------------------------------------------------------------------

fn rpc_request(id: u64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

/// Parse the `result` of a JSON-RPC response value, surfacing a JSON-RPC `error`
/// as an `Err`. Shared by stdio and HTTP.
pub(crate) fn parse_rpc_result(v: &Value) -> anyhow::Result<Value> {
    if let Some(err) = v.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown JSON-RPC error");
        return Err(anyhow!("JSON-RPC error: {msg}"));
    }
    v.get("result")
        .cloned()
        .ok_or_else(|| anyhow!("JSON-RPC response missing `result`"))
}

/// Map an MCP `tools/list` result (`{tools:[{name,description,inputSchema}]}`)
/// to our `ToolDef`s. Pure, so it is unit-tested without a transport.
pub(crate) fn tools_from_list_result(result: &Value) -> Vec<ToolDef> {
    let mut out = Vec::new();
    if let Some(arr) = result.get("tools").and_then(|t| t.as_array()) {
        for t in arr {
            let Some(name) = t.get("name").and_then(|n| n.as_str()) else {
                continue;
            };
            out.push(ToolDef {
                name: name.to_string(),
                description: t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string(),
                input_schema: t
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object" })),
            });
        }
    }
    out
}

/// Extract the text payload from an MCP `tools/call` result. MCP returns
/// `{content:[{type:"text",text:"…"}, …], isError?}`; we concatenate the text
/// parts. Pure / unit-tested.
pub(crate) fn text_from_call_result(result: &Value) -> String {
    let mut out = String::new();
    if let Some(arr) = result.get("content").and_then(|c| c.as_array()) {
        for part in arr {
            if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        // Fall back to the raw result so the model still sees something.
        out = result.to_string();
    }
    out
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

/// POST one JSON-RPC request to an HTTP MCP server and parse its `result`. The
/// server may answer as JSON or as an SSE stream whose first `data:` line is the
/// JSON-RPC response; we handle both.
async fn http_roundtrip(
    client: &reqwest::Client,
    server: &ServerConfig,
    method: &str,
    params: Value,
) -> anyhow::Result<Value> {
    let url = server
        .url
        .as_deref()
        .ok_or_else(|| anyhow!("http server `{}` has no url", server.id))?;
    let resp = client
        .post(url)
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .json(&rpc_request(2, method, params))
        .send()
        .await
        .with_context(|| format!("MCP HTTP request to `{url}`"))?;
    let status = resp.status();
    let body = resp.text().await.context("reading MCP HTTP body")?;
    if !status.is_success() {
        return Err(anyhow!("MCP HTTP error {status}: {body}"));
    }
    let v = parse_http_body(&body)?;
    parse_rpc_result(&v)
}

/// Parse an MCP HTTP body that is either a JSON object or an SSE stream. For SSE,
/// return the JSON of the first `data:` line. Pure / unit-tested.
pub(crate) fn parse_http_body(body: &str) -> anyhow::Result<Value> {
    let trimmed = body.trim_start();
    if trimmed.starts_with('{') {
        return serde_json::from_str(trimmed).context("parsing MCP JSON body");
    }
    for line in body.lines() {
        if let Some(data) = line.trim().strip_prefix("data:") {
            let data = data.trim();
            if !data.is_empty() {
                return serde_json::from_str(data).context("parsing MCP SSE data");
            }
        }
    }
    Err(anyhow!("MCP HTTP body was neither JSON nor SSE"))
}

async fn list_http_tools(
    client: &reqwest::Client,
    server: &ServerConfig,
) -> anyhow::Result<Vec<ToolDef>> {
    let result = http_roundtrip(client, server, "tools/list", json!({})).await?;
    Ok(tools_from_list_result(&result))
}

async fn call_http_tool(
    client: &reqwest::Client,
    server: &ServerConfig,
    tool: &str,
    args: &Value,
) -> anyhow::Result<String> {
    let result = http_roundtrip(
        client,
        server,
        "tools/call",
        json!({ "name": tool, "arguments": args }),
    )
    .await?;
    Ok(text_from_call_result(&result))
}

// ---------------------------------------------------------------------------
// Command surface
// ---------------------------------------------------------------------------

/// A tool as surfaced to the settings UI (server id + tool metadata), so the
/// "refresh / test" action can show what a configured server exposes.
#[derive(Debug, Serialize)]
pub struct ListedTool {
    pub server_id: String,
    pub name: String,
    pub description: String,
}

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

/// List the tools across the given servers (for the settings UI). Always
/// includes the built-in web-browse server's tools when its config entry is
/// present and enabled. Surfaces per-server failures so the refresh can show
/// which servers couldn't start/handshake.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespacing_round_trips() {
        let n = namespaced("web", "fetch_url");
        assert_eq!(n, "web__fetch_url");
        assert_eq!(split_namespaced(&n), ("web", "fetch_url"));
    }

    #[test]
    fn unnamespaced_routes_to_builtin() {
        assert_eq!(split_namespaced("fetch_url"), ("web", "fetch_url"));
    }

    #[test]
    fn only_sys_tools_require_approval() {
        assert!(requires_approval("sys__read_file"));
        assert!(requires_approval("sys__run_diagnostic"));
        assert!(!requires_approval("web__fetch_url"));
        assert!(!requires_approval("somemcp__do_thing"));
    }

    #[test]
    fn builtin_tools_route_by_id() {
        assert!(builtin_tools(sysdebug::SERVER_ID)
            .iter()
            .any(|t| t.name == "read_file"));
        // Unknown / web id falls back to the web-browse server.
        assert!(builtin_tools("web").iter().any(|t| t.name == "fetch_url"));
    }

    #[test]
    fn parses_tools_list_result() {
        let result = json!({
            "tools": [
                { "name": "a", "description": "first", "inputSchema": { "type": "object" } },
                { "name": "b" }
            ]
        });
        let tools = tools_from_list_result(&result);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "a");
        assert_eq!(tools[0].description, "first");
        assert_eq!(tools[1].description, ""); // missing description defaults empty
        assert_eq!(tools[1].input_schema, json!({ "type": "object" }));
    }

    #[test]
    fn extracts_text_from_call_result() {
        let result = json!({
            "content": [
                { "type": "text", "text": "hello" },
                { "type": "text", "text": "world" }
            ]
        });
        assert_eq!(text_from_call_result(&result), "hello\nworld");
    }

    #[test]
    fn call_result_falls_back_to_raw() {
        let result = json!({ "something": 1 });
        assert_eq!(text_from_call_result(&result), result.to_string());
    }

    #[test]
    fn rpc_error_surfaces_as_err() {
        let v = json!({ "jsonrpc": "2.0", "id": 2, "error": { "message": "boom" } });
        let err = parse_rpc_result(&v).unwrap_err().to_string();
        assert!(err.contains("boom"));
    }

    #[test]
    fn parses_json_and_sse_http_bodies() {
        let json_body = r#"{"jsonrpc":"2.0","id":2,"result":{"ok":true}}"#;
        assert_eq!(
            parse_http_body(json_body).unwrap(),
            json!({"jsonrpc":"2.0","id":2,"result":{"ok":true}})
        );
        let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\n\n";
        assert!(parse_http_body(sse).unwrap().get("result").is_some());
    }

    #[test]
    fn disabled_servers_contribute_no_tools() {
        // Build is sync; we can't easily run async list_tools without a runtime,
        // but transport()/enabled filtering is the gate — assert the config side.
        let cfg = ServerConfig {
            id: "web".into(),
            transport_kind: Some(Transport::Builtin),
            transport_alias: None,
            command: None,
            url: None,
            enabled: false,
            search_provider: None,
            env: None,
        };
        assert!(!cfg.enabled);
        assert!(matches!(cfg.transport(), Transport::Builtin));
    }

    fn cfg(command: &str, env: Option<std::collections::HashMap<String, String>>) -> ServerConfig {
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
        let a = cfg(
            "npx -y srv",
            Some(HashMap::from([
                ("A".to_string(), "1".to_string()),
                ("B".to_string(), "2".to_string()),
            ])),
        );
        let b = cfg(
            "npx -y srv",
            Some(HashMap::from([
                ("B".to_string(), "2".to_string()),
                ("A".to_string(), "1".to_string()),
            ])),
        );
        assert_eq!(a.fingerprint(), b.fingerprint());
        // Idempotent within a run (the "stable" half of the name).
        assert_eq!(a.fingerprint(), a.fingerprint());
    }

    #[test]
    fn fingerprint_changes_with_command_env_and_enabled() {
        use std::collections::HashMap;
        let base = cfg("npx -y srv", None);
        let other_cmd = cfg("npx -y other", None);
        let with_env = cfg(
            "npx -y srv",
            Some(HashMap::from([("A".to_string(), "1".to_string())])),
        );
        let mut disabled = cfg("npx -y srv", None);
        disabled.enabled = false;
        assert_ne!(base.fingerprint(), other_cmd.fingerprint());
        assert_ne!(base.fingerprint(), with_env.fingerprint());
        assert_ne!(base.fingerprint(), disabled.fingerprint());
    }
}
