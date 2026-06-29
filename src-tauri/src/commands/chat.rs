//! Chat command. The frontend owns the database (via tauri-plugin-sql); this
//! command only performs the provider API call. It fetches the API key from the
//! keychain in-process so the secret never crosses into the webview.
//!
//! Text deltas stream to the frontend over `on_delta`; the fully-accumulated
//! response is also returned so the frontend can persist the authoritative text.
//!
//! ## The agent loop
//!
//! The tool-call round-trip (T13) lives in [`run_agent_loop`]: stream a provider
//! response, run any tools it asked for, append the synthesized turns, and loop.
//! `chat_stream` is a thin wrapper that resolves the key + tool list and calls it
//! once. Deep research mode (T55) reuses the *same* loop for each dispatched
//! subagent, so orchestrator and subagent share one battle-tested code path.
//!
//! ## Cancellation
//!
//! A single `CancelFlag` (`AtomicBool`) lives in Tauri managed state. `chat_stream`
//! clears it at the start of every request; the `cancel_stream` command sets it.
//! Each provider polls the flag inside its SSE loop and early-exits (returning the
//! text accumulated so far) the same way it stops on `message_stop` / `[DONE]`, so
//! a cancelled request still resolves `Ok(ChatResponse { .. })` with the partial
//! text — no error, nothing lost. Subagents share the same flag, so one cancel
//! halts the orchestrator and every subagent at once.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::oneshot;

use crate::commands::keys;
use crate::mcp::session::McpSessions;
use crate::mcp::{self, ServerConfig};
use crate::providers::{
    self, ChatMessage, ChatResponse, CompletionRequest, StreamDelta, ToolCall, ToolDef, ToolResult,
    Usage,
};
use crate::research;

/// Planner-provided model info (from the frontend's model store). Rides in
/// via `plannerModels` on `chat_stream`; the `list_models` tool returns it.
#[derive(Debug, Clone, Deserialize)]
pub struct PlannerModelInfo {
    pub provider: String,
    #[serde(rename = "model_id")]
    pub model_id: String,
    pub label: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// The tool name for the planner's model-list query.
const PLANNER_LIST_MODELS_TOOL: &str = "planner__list_models";

/// Build the tool definition for the planner's `list_models` tool.
fn planner_tool_def() -> ToolDef {
    ToolDef {
        name: PLANNER_LIST_MODELS_TOOL.to_string(),
        description: "List all available AI models with their exact provider ID, \
        model ID, label, and notes. Call this before building a plan so you use \
        only real model identifiers."
            .to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {}
        }),
    }
}

/// Safety cap on tool-call rounds within one `chat_stream` call, so a model that
/// keeps requesting tools can't loop forever. After the cap we return the last
/// response (best-effort) (T13).
const MAX_TOOL_ROUNDS: usize = 5;

/// Injected as a leading `system` turn only when tools are exposed. Without it,
/// conservative models (notably `mistral-large`) answer about web pages from
/// memory instead of calling `web__fetch_url`, producing confident
/// hallucinations. Nudges tool use and forbids fabricating fetched content.
const TOOL_SYSTEM_PROMPT: &str = "You have tools available. `web__fetch_url` \
returns the readable text of a web page, and `web__search_web` returns a ranked \
list of results (title, URL, snippet) for a query. When the user shares a URL or \
asks about the contents of a specific web page, you MUST call `web__fetch_url` to \
read it before answering. When you need current information but don't have a URL, \
call `web__search_web` first to find relevant pages, then `web__fetch_url` on the \
most relevant result to read it. When the user asks to SEE, show, or find an \
image / picture / photo of something, call `web__search_images` with a query; to \
pull the images out of a specific page or article, call `web__fetch_images` with \
its URL. Both download the pictures and display them to the user automatically — \
do not try to embed image data yourself; just describe what was found and cite the \
sources. Never summarize or describe a page from memory. \
The `sys__*` tools inspect the local machine (read files and directories, check \
permissions, and run read-only diagnostic commands such as listing processes, \
disk, memory, and network). Use them when the user asks about the state of their \
system; prefer them over a shell command whenever they fit — e.g. use \
`sys__list_directory` for `ls`, `sys__read_file` to read a file, and \
`sys__search_files` to find files. When none of those fit and you genuinely need \
to run a shell command, use `sys__run_command`: set `command` to the command and \
`explanation` to an honest, plain-English description of exactly what it does and \
any side effects (files written, data sent, etc.). `run_command` is NOT read-only \
and always requires the user's explicit approval, so reach for it sparingly and \
keep commands minimal. CRITICAL: after a tool returns a result, you MUST continue \
and write a reply that answers the user's question using that result — do not stop \
after calling a tool. If a tool call fails or returns no usable content, say so \
rather than guessing.";

/// Appended as a trailing `user` turn after each tool-result round, to re-anchor
/// the model on answering instead of drifting (small local models otherwise tend
/// to greet generically once a tool turn ends the context).
const POST_TOOL_NUDGE: &str = "The tool results above are now available to you. \
Using them, give a direct answer to my previous question. Do not greet me or ask \
what I need next — just answer the question.";

/// Shared cancellation flag for the in-flight stream, held in Tauri managed
/// state. Only one stream runs at a time from the chat UI.
#[derive(Default)]
pub struct CancelFlag(pub Arc<AtomicBool>);

/// Tool calls awaiting user approval, keyed by tool-call id. The chat loop
/// inserts a one-shot sender before emitting an approval request and awaits the
/// receiver; `approve_tool_call` (or `cancel_stream`) fulfills it. Held in Tauri
/// managed state so the command and the loop share it.
#[derive(Default)]
pub struct PendingApprovals(pub Mutex<HashMap<String, oneshot::Sender<bool>>>);

#[tauri::command]
// Tauri command surface: provider/model/messages, the delta channel, the MCP
// server list + per-thread session registry, the deep-research toggle, and the
// cancel/approval state.
#[allow(clippy::too_many_arguments)]
pub async fn chat_stream(
    provider: String,
    model: String,
    messages: Vec<ChatMessage>,
    on_delta: Channel<StreamDelta>,
    #[allow(non_snake_case)] mcpServers: Option<Vec<ServerConfig>>,
    #[allow(non_snake_case)] threadId: String,
    #[allow(non_snake_case)] deepResearch: Option<bool>,
    #[allow(non_snake_case)] subagentConcurrency: Option<usize>,
    #[allow(non_snake_case)] captureReasoning: Option<bool>,
    #[allow(non_snake_case)] captureTrace: Option<bool>,
    #[allow(non_snake_case)] skipTools: Option<bool>,
    #[allow(non_snake_case)] plannerModels: Option<Vec<PlannerModelInfo>>,
    // JSON Schema for structured planner/critic output; None for normal chat.
    #[allow(non_snake_case)] responseSchema: Option<serde_json::Value>,
    // Base URL for the configured provider (OpenAI-compatible: the API root;
    // anthropic/gemini: overrides their default endpoint). Absent ⇒ default.
    #[allow(non_snake_case)] baseUrl: Option<String>,
    // Wire protocol: "openai" (default) | "anthropic" | "gemini". Ollama ignores it.
    protocol: Option<String>,
    sessions: State<'_, McpSessions>,
    cancel: State<'_, CancelFlag>,
    approvals: State<'_, PendingApprovals>,
    key_cache: State<'_, keys::KeyCache>,
    app: AppHandle,
) -> Result<ChatResponse, String> {
    // Reset any leftover cancellation from a previous request.
    let flag = cancel.0.clone();
    flag.store(false, Ordering::Relaxed);

    if model.trim().is_empty() {
        return Err("No model selected. Pick a model before sending.".into());
    }

    // Keyless providers (local Ollama) skip the keychain: the daemon ignores
    // Authorization, so an empty key is passed through. Every other provider is a
    // configured entry whose key is optional (a local OpenAI-compatible server may
    // need none) — a missing key streams with an empty credential and the
    // upstream 401 surfaces as the error. Cached read: the keychain (and its OS
    // authorization prompt) is hit at most once per provider per app run.
    let api_key = if providers::is_keyless(&provider) {
        String::new()
    } else {
        keys::get_api_key_cached(&key_cache, &provider)?.unwrap_or_default()
    };

    let client = reqwest::Client::new();

    // Build the tool list from the enabled MCP servers. When none are enabled
    // (or none were passed), `tools` is empty and the request below is
    // byte-identical to a plain completion — exactly one provider round, no
    // `tools` field on the wire (T13 no-tools invariant).
    // When `skipTools` is set (e.g. planner calls), all MCP server config is
    // ignored so the model sees no tools and can't hallucinate tool names as
    // model identifiers.
    let servers = if skipTools.unwrap_or(false) {
        Vec::new()
    } else {
        mcpServers.unwrap_or_default()
    };
    let mut tools = if servers.is_empty() {
        Vec::new()
    } else {
        mcp::list_tools(&client, sessions.inner(), &threadId, &servers).await
    };

    // Deep research (T55) only engages when web tools exist for subagents to use;
    // it adds the dispatch tool + a decomposition system prompt. With it off (or
    // no tools), the path below is unchanged.
    let deep_research = deepResearch.unwrap_or(false) && !tools.is_empty();
    if deep_research {
        tools.push(research::dispatch_tool_def());
    }

    // Planner mode: when plannerModels is present, expose the list_models tool
    // so the planner model can discover exact model IDs before building a plan.
    if plannerModels.is_some() {
        tools.push(planner_tool_def());
    }
    // How many subagents run at once (Settings → Advanced), clamped to a sane
    // range; defaulted when the setting is absent.
    let subagent_concurrency = research::clamp_concurrency(
        subagentConcurrency.unwrap_or(research::DEFAULT_SUBAGENT_CONCURRENCY),
    );

    // Inject the tool-usage system prompt only when real MCP tools exist
    // (not just the planner list_models or research dispatch meta-tools).
    let has_mcp_tools = tools.iter().any(|t| {
        t.name != PLANNER_LIST_MODELS_TOOL && t.name != research::DISPATCH_TOOL_NAME
    });
    let history = with_system_prompt(messages, has_mcp_tools, deep_research);

    // Resolve the skill paths (skills dir + per-thread workspace root) for the
    // built-in `skill__*` tool. `Default` (empty paths) degrades gracefully if
    // the app-data dir can't be resolved — the tools just report "not found".
    let skill_rt = mcp::skill_tool::SkillRuntime {
        skills_dir: crate::skills::skills_dir(&app).unwrap_or_default(),
        workspace_root: crate::skills::workspace_root(&app).unwrap_or_default(),
    };

    run_agent_loop(
        &client,
        &provider,
        &model,
        &api_key,
        baseUrl.as_deref(),
        protocol.as_deref(),
        history,
        &tools,
        &servers,
        sessions.inner(),
        &threadId,
        &on_delta,
        &flag,
        Some(approvals.inner()),
        MAX_TOOL_ROUNDS,
        deep_research,
        subagent_concurrency,
        captureReasoning.unwrap_or(false),
        captureTrace.unwrap_or(false),
        &plannerModels,
        responseSchema.as_ref(),
        &skill_rt,
    )
    .await
}

/// One agent's tool-call loop (T13). Streams provider responses, runs the tools
/// the model asks for, appends the synthesized assistant/tool turns, and repeats
/// until the model answers without tools or `max_rounds` is hit. Reused verbatim
/// by the orchestrator and by each deep-research subagent.
///
/// - `approvals`: `Some` for the orchestrator (gated `sys__*` calls prompt the
///   user); `None` for subagents, which expose no gated tools.
/// - `allow_dispatch`: when true, a `research__dispatch` call is intercepted and
///   handled in-process by [`run_subagents`] instead of going to MCP. Always
///   false for subagents, so recursion is structurally bounded to depth 1.
#[allow(clippy::too_many_arguments)]
async fn run_agent_loop(
    client: &reqwest::Client,
    provider: &str,
    model: &str,
    api_key: &str,
    base_url: Option<&str>,
    protocol: Option<&str>,
    mut history: Vec<ChatMessage>,
    tools: &[ToolDef],
    servers: &[ServerConfig],
    sessions: &McpSessions,
    thread_id: &str,
    on_delta: &Channel<StreamDelta>,
    cancel: &AtomicBool,
    approvals: Option<&PendingApprovals>,
    max_rounds: usize,
    allow_dispatch: bool,
    subagent_concurrency: usize,
    reasoning: bool,
    trace: bool,
    planner_models: &Option<Vec<PlannerModelInfo>>,
    response_schema: Option<&serde_json::Value>,
    skill_rt: &mcp::skill_tool::SkillRuntime,
) -> Result<ChatResponse, String> {
    // The full streamed transcript: text deltas across every round. Returned as
    // the authoritative content so the persisted message matches what streamed
    // in. (Intermediate tool-call rounds usually carry no text of their own.)
    let mut transcript = String::new();
    // Token spend by dispatched subagents (deep research), folded into the
    // returned usage so the orchestrator's message reflects the true cost.
    let mut extra_usage = Usage::default();

    for _round in 0..max_rounds {
        let req = CompletionRequest {
            model,
            api_key,
            messages: &history,
            tools,
            base_url,
            protocol,
            reasoning,
            trace,
            round: _round as u32,
            response_schema,
        };

        let mut resp = providers::stream(client, provider, &req, on_delta, cancel)
            .await
            .map_err(|e| e.to_string())?;
        transcript.push_str(&resp.content);
        if trace {
            let _ = on_delta.send(StreamDelta::api_trace(
                "response",
                _round as u32,
                response_trace(&resp),
            ));
        }

        // No tool calls → normal completion; return the authoritative response.
        // (Also the only path taken when `tools` is empty.)
        if resp.tool_calls.is_empty() || cancel.load(Ordering::Relaxed) {
            resp.usage.add(&extra_usage);
            return Ok(ChatResponse {
                content: transcript,
                ..resp
            });
        }

        // Surface each requested tool call to the UI as a structured event (the
        // frontend renders it as a distinct chip and persists it), then execute
        // it via MCP and feed the results back. Calls to the read-only
        // system-diagnostics server are gated: we emit an approval request and
        // wait for the user before running anything.
        let mut results = Vec::with_capacity(resp.tool_calls.len());
        let mut cancelled = false;
        for call in &resp.tool_calls {
            // Deep-research dispatch is handled in-process (spawns subagents and
            // emits its own lifecycle events) rather than routed through MCP.
            if allow_dispatch && call.name == research::DISPATCH_TOOL_NAME {
                let (content, usage) = run_subagents(
                    client,
                    provider,
                    model,
                    api_key,
                    base_url,
                    protocol,
                    tools,
                    servers,
                    sessions,
                    thread_id,
                    on_delta,
                    cancel,
                    call,
                    subagent_concurrency,
                    skill_rt,
                )
                .await;
                extra_usage.add(&usage);
                results.push(ToolResult {
                    tool_call_id: call.id.clone(),
                    name: call.name.clone(),
                    content,
                });
                if cancel.load(Ordering::Relaxed) {
                    cancelled = true;
                    break;
                }
                continue;
            }

            // Planner model-list query: handled in-process, returns the exact
            // models the frontend passed.
            if call.name == PLANNER_LIST_MODELS_TOOL {
                if let Some(ref models) = *planner_models {
                    let mut buf = String::from("Available models:\n");
                    for m in models {
                        let note = m.notes.as_deref().unwrap_or("");
                        let note_suffix = if note.is_empty() {
                            String::new()
                        } else {
                            format!(" — {note}")
                        };
                        let caps = if m.capabilities.is_empty() {
                            String::new()
                        } else {
                            format!(
                                " [{}]",
                                m.capabilities
                                    .iter()
                                    .map(|c| c.as_str())
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            )
                        };
                        buf.push_str(&format!(
                            "- {} · {} (provider: \"{}\", model: \"{}\"){caps}{note_suffix}\n",
                            m.provider, m.label, m.provider, m.model_id
                        ));
                    }
                    on_delta
                        .send(StreamDelta::tool(call, None))
                        .map_err(|e| format!("channel send failed: {e}"))?;
                    on_delta
                        .send(StreamDelta::tool_done(&call.id, true))
                        .map_err(|e| format!("channel send failed: {e}"))?;
                    results.push(ToolResult {
                        tool_call_id: call.id.clone(),
                        name: call.name.clone(),
                        content: buf,
                    });
                    continue;
                }
            }

            // Hallucinated tool name: the model asked for a tool that isn't in
            // the exposed set (small/local models do this often, especially when
            // they invent a model id as a tool). Tell it the tool doesn't exist —
            // with the real list — so it can recover, rather than routing a bogus
            // call to MCP and dead-ending.
            if !tools.iter().any(|t| t.name == call.name) {
                let available = tools
                    .iter()
                    .map(|t| t.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                let _ = on_delta.send(StreamDelta::tool(call, None));
                let _ = on_delta.send(StreamDelta::tool_done(&call.id, false));
                results.push(ToolResult {
                    tool_call_id: call.id.clone(),
                    name: call.name.clone(),
                    content: format!(
                        "No tool named \"{}\" exists. Available tools: {}. Do not call \
                         unavailable tools — answer using the information you already have.",
                        call.name,
                        if available.is_empty() {
                            "(none)"
                        } else {
                            &available
                        }
                    ),
                });
                continue;
            }

            if mcp::requires_approval(&call.name) {
                // Gated tools are orchestrator-only; subagents never reach here.
                let Some(approvals) = approvals else {
                    results.push(ToolResult {
                        tool_call_id: call.id.clone(),
                        name: call.name.clone(),
                        content: "Tool not available in this context.".into(),
                    });
                    continue;
                };
                let info = mcp::describe_call(call);
                let (tx, rx) = oneshot::channel();
                approvals.0.lock().unwrap().insert(call.id.clone(), tx);
                on_delta
                    .send(StreamDelta::approval(
                        call,
                        info.summary,
                        info.detail,
                        info.explanation,
                        info.warning,
                    ))
                    .map_err(|e| format!("channel send failed: {e}"))?;

                // Block until the user decides (or cancel_stream drains us). A
                // dropped sender or `false` both mean "do not run".
                let approved = rx.await.unwrap_or(false);
                approvals.0.lock().unwrap().remove(&call.id);
                cancelled = cancel.load(Ordering::Relaxed);

                if !approved {
                    results.push(ToolResult {
                        tool_call_id: call.id.clone(),
                        name: call.name.clone(),
                        content: "User denied this tool call.".into(),
                    });
                    if cancelled {
                        break;
                    }
                    continue;
                }
            }

            // The resolved command line / target (for tools that run one) rides
            // along on the start event so the UI's live panel can show `$ …`.
            let command = if mcp::requires_approval(&call.name) {
                Some(mcp::describe_call(call).detail)
            } else {
                None
            };
            on_delta
                .send(StreamDelta::tool(call, command))
                .map_err(|e| format!("channel send failed: {e}"))?;

            // Runs the tool, streaming any live output to the UI as it arrives.
            let content =
                mcp::call_tool(client, sessions, thread_id, servers, call, on_delta, skill_rt)
                    .await;
            let ok = !content.starts_with("tool error:");
            on_delta
                .send(StreamDelta::tool_done(&call.id, ok))
                .map_err(|e| format!("channel send failed: {e}"))?;
            results.push(ToolResult {
                tool_call_id: call.id.clone(),
                name: call.name.clone(),
                content,
            });
        }

        // User cancelled while an approval was pending (or mid-dispatch): stop
        // here with the text streamed so far (mirrors provider-loop cancellation).
        if cancelled {
            resp.usage.add(&extra_usage);
            return Ok(ChatResponse {
                content: transcript,
                ..resp
            });
        }

        // Append the assistant turn that asked for the tools, then a tool turn
        // carrying the results, and loop for the model's next round.
        history.push(ChatMessage {
            role: "assistant".into(),
            content: resp.content,
            images: Vec::new(),
            tool_calls: resp.tool_calls,
            tool_results: Vec::new(),
            // Echoed back before the tool_use block on the next round — Anthropic
            // requires this when extended thinking + tool use are combined.
            thinking_blocks: resp.thinking_blocks,
        });
        history.push(ChatMessage {
            role: "tool".into(),
            content: String::new(),
            images: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: results,
            thinking_blocks: Vec::new(),
        });
        // Re-anchor the task right next to the generation point. Weaker (small,
        // local) models often lose the thread after a tool turn and fall back to
        // a generic persona greeting; a trailing instruction to actually answer
        // pulls them back on task. Harmless for strong models. (Loop-local only:
        // these synthetic turns never touch the DB.)
        history.push(ChatMessage {
            role: "user".into(),
            content: POST_TOOL_NUDGE.into(),
            images: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            thinking_blocks: Vec::new(),
        });
    }

    // Round cap hit: do one final tool-less round so the model produces a text
    // answer instead of requesting yet more tools.
    let req = CompletionRequest {
        model,
        api_key,
        messages: &history,
        tools: &[],
        base_url,
        protocol,
        reasoning,
        trace,
        round: max_rounds as u32,
        response_schema,
    };
    let mut resp = providers::stream(client, provider, &req, on_delta, cancel)
        .await
        .map_err(|e| e.to_string())?;
    transcript.push_str(&resp.content);
    if trace {
        let _ = on_delta.send(StreamDelta::api_trace(
            "response",
            max_rounds as u32,
            response_trace(&resp),
        ));
    }
    resp.usage.add(&extra_usage);
    Ok(ChatResponse {
        content: transcript,
        ..resp
    })
}

/// Execute a `research__dispatch` call (deep research, T55): parse its subtasks,
/// run one subagent per subtask concurrently (capped), and aggregate their
/// summaries into the tool-result string fed back to the orchestrator. Returns
/// that string plus the subagents' combined token usage.
///
/// Each subagent runs the *same* [`run_agent_loop`] over a fresh, focused
/// history with the web tools available but **without** the dispatch tool
/// (`allow_dispatch = false`), so it cannot recurse. Its own provider/tool deltas
/// go to a throwaway sink channel — only the lifecycle events (dispatched →
/// running → done/failed) reach the UI, keeping the chat readable and the
/// orchestrator's context clean.
#[allow(clippy::too_many_arguments)]
async fn run_subagents(
    client: &reqwest::Client,
    provider: &str,
    model: &str,
    api_key: &str,
    base_url: Option<&str>,
    protocol: Option<&str>,
    orchestrator_tools: &[ToolDef],
    servers: &[ServerConfig],
    sessions: &McpSessions,
    thread_id: &str,
    on_delta: &Channel<StreamDelta>,
    cancel: &AtomicBool,
    call: &ToolCall,
    concurrency: usize,
    skill_rt: &mcp::skill_tool::SkillRuntime,
) -> (String, Usage) {
    let tasks = match research::parse_subtasks(&call.arguments) {
        Ok(t) => t,
        // A malformed request becomes the tool result so the model self-corrects.
        Err(e) => return (e, Usage::default()),
    };

    // Subagents get the web/MCP tools but not the dispatch tool (depth bound 1)
    // or the planner tool (subagents don't plan).
    let sub_tools: Vec<ToolDef> = orchestrator_tools
        .iter()
        .filter(|t| t.name != research::DISPATCH_TOOL_NAME && t.name != PLANNER_LIST_MODELS_TOOL)
        .cloned()
        .collect();
    let sub_tools = &sub_tools;

    // The subagent's system turn carries the FULL tool-use prompt (the same
    // strong "after a tool returns, you MUST write a reply — never answer from
    // memory" guidance the orchestrator gets) plus the subagent addendum (be
    // terse, one task). Without the tool prompt, weaker models (e.g. Mistral)
    // tend to search and then fall silent, yielding empty summaries.
    let subagent_prompt = format!(
        "{TOOL_SYSTEM_PROMPT}\n\n{}",
        research::SUBAGENT_SYSTEM_PROMPT
    );
    let subagent_prompt = subagent_prompt.as_str();

    // A subagent's own text/tool deltas are swallowed here: the UI shows only the
    // subagent cards (lifecycle), not each subagent's streaming internals.
    let sink: Channel<StreamDelta> = Channel::new(|_| Ok::<(), tauri::Error>(()));
    let sink = &sink;

    // Stable ids (deterministic; no RNG) so the UI can update one card per task.
    let dispatched: Vec<(String, String)> = tasks
        .iter()
        .enumerate()
        .map(|(i, task)| (format!("{}-{i}", call.id), task.clone()))
        .collect();
    for (id, task) in &dispatched {
        let _ = on_delta.send(StreamDelta::subagent(
            id,
            "dispatched",
            Some(task.clone()),
            None,
        ));
    }

    // Build the per-subagent futures with `Iterator::map` (owned `id`/`task`
    // captures + shared `&` refs), then drive them concurrently. Building futures
    // this way — rather than `Stream::map` — sidesteps the higher-ranked-lifetime
    // "not general enough" error that an async closure over a borrowed stream item
    // triggers.
    let subagents = dispatched
        .into_iter()
        .enumerate()
        .map(|(i, (id, task))| async move {
            let _ = on_delta.send(StreamDelta::subagent(&id, "running", None, None));
            if cancel.load(Ordering::Relaxed) {
                let _ = on_delta.send(StreamDelta::subagent(
                    &id,
                    "failed",
                    None,
                    Some("cancelled".into()),
                ));
                return (i, task, Err("cancelled".to_string()), Usage::default());
            }
            let history = vec![msg("system", subagent_prompt), msg("user", &task)];
            // Box::pin breaks the run_agent_loop ↔ run_subagents type cycle.
            let res = Box::pin(run_agent_loop(
                client,
                provider,
                model,
                api_key,
                base_url,
                protocol,
                history,
                sub_tools,
                servers,
                sessions,
                thread_id,
                sink,
                cancel,
                None,
                research::SUBAGENT_MAX_ROUNDS,
                false,
                concurrency,
                // Subagent internals go to the sink (swallowed); capturing
                // reasoning/trace there would be wasted work — and disabling
                // thinking sidesteps the Anthropic thinking+tools echo-back.
                false,
                false,
                &None, // no planner tools for subagents
                None,  // no structured-output schema for subagents
                skill_rt,
            ))
            .await;
            match res {
                Ok(r) => {
                    let summary = r.content.trim().to_string();
                    let summary = if summary.is_empty() {
                        "(no findings)".to_string()
                    } else {
                        summary
                    };
                    let _ = on_delta.send(StreamDelta::subagent(
                        &id,
                        "done",
                        None,
                        Some(summary.clone()),
                    ));
                    (i, task, Ok(summary), r.usage)
                }
                Err(e) => {
                    let _ =
                        on_delta.send(StreamDelta::subagent(&id, "failed", None, Some(e.clone())));
                    (i, task, Err(e), Usage::default())
                }
            }
        });

    let mut results: Vec<(usize, String, Result<String, String>, Usage)> =
        futures_util::stream::iter(subagents)
            .buffer_unordered(concurrency)
            .collect()
            .await;

    // Restore subtask order (buffer_unordered completes out of order) and sum the
    // subagents' usage for cost attribution.
    results.sort_by_key(|(i, ..)| *i);
    let mut total = Usage::default();
    let mut pairs = Vec::with_capacity(results.len());
    for (_, task, result, usage) in results {
        total.add(&usage);
        pairs.push((task, result));
    }
    (research::aggregate_summaries(&pairs), total)
}

/// Compact response summary for the developer API trace. A full response body
/// isn't captured (the streamed text already is); this names the model, token
/// usage, the finish reason, and any tool calls the model emitted this round.
fn response_trace(resp: &ChatResponse) -> serde_json::Value {
    serde_json::json!({
        "model": resp.model,
        "usage": {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
            "cache_creation_tokens": resp.usage.cache_creation_tokens,
            "cache_read_tokens": resp.usage.cache_read_tokens,
        },
        "finish": if resp.tool_calls.is_empty() { "end" } else { "tool_use" },
        "toolCalls": resp
            .tool_calls
            .iter()
            .map(|c| c.name.clone())
            .collect::<Vec<_>>(),
        "textChars": resp.content.chars().count(),
    })
}

/// Build a synthetic conversation turn with no images/tools (used for the
/// subagent system + task turns).
fn msg(role: &str, content: &str) -> ChatMessage {
    ChatMessage {
        role: role.into(),
        content: content.into(),
        images: Vec::new(),
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        thinking_blocks: Vec::new(),
    }
}

/// Prepend the system prompt(s) when tools are exposed: always the tool-use
/// nudge, plus the deep-research decomposition prompt when that mode is on.
/// Returns the history unchanged when no tools are exposed (so the no-tools
/// request stays byte-identical). Pure — unit-tested.
fn with_system_prompt(
    messages: Vec<ChatMessage>,
    has_tools: bool,
    deep_research: bool,
) -> Vec<ChatMessage> {
    if !has_tools {
        return messages;
    }
    let mut content = TOOL_SYSTEM_PROMPT.to_string();
    if deep_research {
        content.push_str("\n\n");
        content.push_str(research::RESEARCH_SYSTEM_PROMPT);
    }
    let mut out = Vec::with_capacity(messages.len() + 1);
    out.push(msg("system", &content));
    out.extend(messages);
    out
}

/// Resolve a pending tool-call approval. `approved = false` (or an unknown id)
/// declines; the chat loop then feeds the model a "denied" tool result and
/// continues. No-op if the call was already resolved (e.g. cancelled).
#[tauri::command]
pub fn approve_tool_call(id: String, approved: bool, approvals: State<'_, PendingApprovals>) {
    if let Some(tx) = approvals.0.lock().unwrap().remove(&id) {
        let _ = tx.send(approved);
    }
}

/// Request cancellation of the in-flight stream. Sets the shared flag; the
/// running provider loop observes it and stops, so the pending `chat_stream`
/// call resolves with the partial text. Also drains any pending tool-call
/// approvals (declining them), so a stream blocked on the approval gate — which
/// is awaiting, not polling the flag — unblocks immediately.
#[tauri::command]
pub fn cancel_stream(cancel: State<'_, CancelFlag>, approvals: State<'_, PendingApprovals>) {
    cancel.0.store(true, Ordering::Relaxed);
    let mut pending = approvals.0.lock().unwrap();
    for (_id, tx) in pending.drain() {
        let _ = tx.send(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(content: &str) -> ChatMessage {
        msg("user", content)
    }

    #[test]
    fn no_tools_leaves_history_unchanged() {
        let out = with_system_prompt(vec![user("hi"), user("there")], false, false);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "user");
        assert_eq!(out[0].content, "hi");
        assert_eq!(out[1].content, "there");
    }

    #[test]
    fn tools_prepend_system_prompt() {
        let out = with_system_prompt(vec![user("hi")], true, false);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "system");
        assert!(!out[0].content.is_empty());
        // No research prompt when deep research is off.
        assert!(!out[0].content.contains("Deep research mode is ON"));
        // Original turns follow, in order.
        assert_eq!(out[1].role, "user");
        assert_eq!(out[1].content, "hi");
    }

    #[test]
    fn deep_research_appends_research_prompt() {
        let out = with_system_prompt(vec![user("hi")], true, true);
        assert_eq!(out[0].role, "system");
        // Carries both the tool prompt and the deep-research prompt.
        assert!(out[0].content.contains("web__fetch_url"));
        assert!(out[0].content.contains("Deep research mode is ON"));
    }
}
