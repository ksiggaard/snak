//! Chat command. The frontend owns the database (via tauri-plugin-sql); this
//! command only performs the provider API call. It fetches the API key from the
//! keychain in-process so the secret never crosses into the webview.
//!
//! Text deltas stream to the frontend over `on_delta`; the fully-accumulated
//! response is also returned so the frontend can persist the authoritative text.
//!
//! ## Cancellation
//!
//! A single `CancelFlag` (`AtomicBool`) lives in Tauri managed state. `chat_stream`
//! clears it at the start of every request; the `cancel_stream` command sets it.
//! Each provider polls the flag inside its SSE loop and early-exits (returning the
//! text accumulated so far) the same way it stops on `message_stop` / `[DONE]`, so
//! a cancelled request still resolves `Ok(ChatResponse { .. })` with the partial
//! text — no error, nothing lost.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::oneshot;

use crate::commands::keys;
use crate::mcp::{self, ServerConfig};
use crate::providers::{
    self, ChatMessage, ChatResponse, CompletionRequest, StreamDelta, ToolResult,
};

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
system. CRITICAL: after a tool returns a result, you MUST continue and write a \
reply that answers the user's question using that result — do not stop after \
calling a tool. If a tool call fails or returns no usable content, say so rather \
than guessing.";

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
// server list + per-thread session registry, and the cancel/approval state.
#[allow(clippy::too_many_arguments)]
pub async fn chat_stream(
    provider: String,
    model: String,
    messages: Vec<ChatMessage>,
    on_delta: Channel<StreamDelta>,
    #[allow(non_snake_case)] mcpServers: Option<Vec<ServerConfig>>,
    #[allow(non_snake_case)] threadId: String,
    sessions: State<'_, crate::mcp::session::McpSessions>,
    cancel: State<'_, CancelFlag>,
    approvals: State<'_, PendingApprovals>,
) -> Result<ChatResponse, String> {
    // Reset any leftover cancellation from a previous request.
    let flag = cancel.0.clone();
    flag.store(false, Ordering::Relaxed);

    if model.trim().is_empty() {
        return Err("No model selected. Pick a model before sending.".into());
    }

    // Keyless providers (local Ollama) skip the keychain: the daemon ignores
    // Authorization, so an empty key is passed through.
    let api_key = if providers::is_keyless(&provider) {
        String::new()
    } else {
        keys::get_api_key(&provider)?
            .ok_or_else(|| format!("No API key set for {provider}. Add one in Settings."))?
    };

    let client = reqwest::Client::new();

    // Build the tool list from the enabled MCP servers. When none are enabled
    // (or none were passed), `tools` is empty and the request below is
    // byte-identical to a plain completion — exactly one provider round, no
    // `tools` field on the wire (T13 no-tools invariant).
    let servers = mcpServers.unwrap_or_default();
    let tools = if servers.is_empty() {
        Vec::new()
    } else {
        mcp::list_tools(&client, sessions.inner(), &threadId, &servers).await
    };

    // Working history grows as the loop appends assistant tool-call turns and
    // tool-result turns between provider rounds. When tools are exposed, a
    // leading system prompt nudges the model to actually call them (some models
    // otherwise answer from memory and hallucinate); the no-tools path is left
    // untouched, so it stays byte-identical to before.
    let mut history = with_tool_system_prompt(messages, !tools.is_empty());

    // The full streamed transcript: text deltas across every round plus the
    // tool-activity lines injected below. Returned as the authoritative content
    // so the persisted message matches exactly what the user saw stream in.
    // (Intermediate tool-call rounds usually carry no text of their own.)
    let mut transcript = String::new();

    for _round in 0..MAX_TOOL_ROUNDS {
        let req = CompletionRequest {
            model: &model,
            api_key: &api_key,
            messages: &history,
            tools: &tools,
        };

        let resp = providers::stream(&client, &provider, &req, &on_delta, &flag)
            .await
            .map_err(|e| e.to_string())?;
        transcript.push_str(&resp.content);

        // No tool calls → normal completion; return the authoritative response.
        // (Also the only path taken when `tools` is empty.)
        if resp.tool_calls.is_empty() || flag.load(Ordering::Relaxed) {
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
            if mcp::requires_approval(&call.name) {
                let (summary, detail) = mcp::describe_call(call);
                let (tx, rx) = oneshot::channel();
                approvals.0.lock().unwrap().insert(call.id.clone(), tx);
                on_delta
                    .send(StreamDelta::approval(call, summary, detail))
                    .map_err(|e| format!("channel send failed: {e}"))?;

                // Block until the user decides (or cancel_stream drains us). A
                // dropped sender or `false` both mean "do not run".
                let approved = rx.await.unwrap_or(false);
                approvals.0.lock().unwrap().remove(&call.id);
                cancelled = flag.load(Ordering::Relaxed);

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
                Some(mcp::describe_call(call).1)
            } else {
                None
            };
            on_delta
                .send(StreamDelta::tool(call, command))
                .map_err(|e| format!("channel send failed: {e}"))?;

            // Runs the tool, streaming any live output to the UI as it arrives.
            let content = mcp::call_tool(
                &client,
                sessions.inner(),
                &threadId,
                &servers,
                call,
                &on_delta,
            )
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

        // User cancelled while an approval was pending: stop here with the text
        // streamed so far (mirrors the provider-loop cancellation behavior).
        if cancelled {
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
        });
        history.push(ChatMessage {
            role: "tool".into(),
            content: String::new(),
            images: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: results,
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
        });
    }

    // Round cap hit: do one final tool-less round so the model produces a text
    // answer instead of requesting yet more tools.
    let req = CompletionRequest {
        model: &model,
        api_key: &api_key,
        messages: &history,
        tools: &[],
    };
    let resp = providers::stream(&client, &provider, &req, &on_delta, &flag)
        .await
        .map_err(|e| e.to_string())?;
    transcript.push_str(&resp.content);
    Ok(ChatResponse {
        content: transcript,
        ..resp
    })
}

/// Prepend the tool-use system prompt when any tools are exposed; otherwise
/// return the history unchanged (so the no-tools request stays byte-identical).
/// Pure — unit-tested.
fn with_tool_system_prompt(messages: Vec<ChatMessage>, has_tools: bool) -> Vec<ChatMessage> {
    if !has_tools {
        return messages;
    }
    let mut out = Vec::with_capacity(messages.len() + 1);
    out.push(ChatMessage {
        role: "system".into(),
        content: TOOL_SYSTEM_PROMPT.into(),
        images: Vec::new(),
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
    });
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
        ChatMessage {
            role: "user".into(),
            content: content.into(),
            images: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
        }
    }

    #[test]
    fn no_tools_leaves_history_unchanged() {
        let out = with_tool_system_prompt(vec![user("hi"), user("there")], false);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "user");
        assert_eq!(out[0].content, "hi");
        assert_eq!(out[1].content, "there");
    }

    #[test]
    fn tools_prepend_system_prompt() {
        let out = with_tool_system_prompt(vec![user("hi")], true);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "system");
        assert!(!out[0].content.is_empty());
        // Original turns follow, in order.
        assert_eq!(out[1].role, "user");
        assert_eq!(out[1].content, "hi");
    }
}
