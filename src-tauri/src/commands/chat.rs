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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::commands::keys;
use crate::mcp::{self, ServerConfig};
use crate::providers::{
    self, ChatMessage, ChatResponse, CompletionRequest, StreamDelta, ToolResult,
};

/// Safety cap on tool-call rounds within one `chat_stream` call, so a model that
/// keeps requesting tools can't loop forever. After the cap we return the last
/// response (best-effort) (T13).
const MAX_TOOL_ROUNDS: usize = 5;

/// Shared cancellation flag for the in-flight stream, held in Tauri managed
/// state. Only one stream runs at a time from the chat UI.
#[derive(Default)]
pub struct CancelFlag(pub Arc<AtomicBool>);

#[tauri::command]
pub async fn chat_stream(
    provider: String,
    model: String,
    messages: Vec<ChatMessage>,
    on_delta: Channel<StreamDelta>,
    #[allow(non_snake_case)] mcpServers: Option<Vec<ServerConfig>>,
    cancel: State<'_, CancelFlag>,
) -> Result<ChatResponse, String> {
    // Reset any leftover cancellation from a previous request.
    let flag = cancel.0.clone();
    flag.store(false, Ordering::Relaxed);

    if model.trim().is_empty() {
        return Err("No model selected. Pick a model before sending.".into());
    }

    let api_key = keys::get_api_key(&provider)?
        .ok_or_else(|| format!("No API key set for {provider}. Add one in Settings."))?;

    let client = reqwest::Client::new();

    // Build the tool list from the enabled MCP servers. When none are enabled
    // (or none were passed), `tools` is empty and the request below is
    // byte-identical to a plain completion — exactly one provider round, no
    // `tools` field on the wire (T13 no-tools invariant).
    let servers = mcpServers.unwrap_or_default();
    let tools = if servers.is_empty() {
        Vec::new()
    } else {
        mcp::list_tools(&client, &servers).await
    };

    // Working history grows as the loop appends assistant tool-call turns and
    // tool-result turns between provider rounds.
    let mut history = messages;

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

        // No tool calls → normal completion; return the authoritative response.
        // (Also the only path taken when `tools` is empty.)
        if resp.tool_calls.is_empty() || flag.load(Ordering::Relaxed) {
            return Ok(resp);
        }

        // Execute every requested tool via MCP, then feed results back.
        let mut results = Vec::with_capacity(resp.tool_calls.len());
        for call in &resp.tool_calls {
            let content = mcp::call_tool(&client, &servers, call).await;
            results.push(ToolResult {
                tool_call_id: call.id.clone(),
                name: call.name.clone(),
                content,
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
    }

    // Round cap hit: do one final tool-less round so the model produces a text
    // answer instead of requesting yet more tools.
    let req = CompletionRequest {
        model: &model,
        api_key: &api_key,
        messages: &history,
        tools: &[],
    };
    providers::stream(&client, &provider, &req, &on_delta, &flag)
        .await
        .map_err(|e| e.to_string())
}

/// Request cancellation of the in-flight stream. Sets the shared flag; the
/// running provider loop observes it and stops, so the pending `chat_stream`
/// call resolves with the partial text.
#[tauri::command]
pub fn cancel_stream(cancel: State<'_, CancelFlag>) {
    cancel.0.store(true, Ordering::Relaxed);
}
