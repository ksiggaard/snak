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
use crate::providers::{self, ChatMessage, ChatResponse, CompletionRequest, StreamDelta};

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
    let req = CompletionRequest {
        model: &model,
        api_key: &api_key,
        messages: &messages,
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
