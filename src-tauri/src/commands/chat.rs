//! Chat command. The frontend owns the database (via tauri-plugin-sql); this
//! command only performs the provider API call. It fetches the API key from the
//! keychain in-process so the secret never crosses into the webview.
//!
//! Text deltas stream to the frontend over `on_delta`; the fully-accumulated
//! response is also returned so the frontend can persist the authoritative text.

use tauri::ipc::Channel;

use crate::commands::keys;
use crate::providers::{self, ChatMessage, ChatResponse, CompletionRequest, StreamDelta};

#[tauri::command]
pub async fn chat_stream(
    provider: String,
    model: String,
    messages: Vec<ChatMessage>,
    on_delta: Channel<StreamDelta>,
) -> Result<ChatResponse, String> {
    let api_key =
        keys::get_api_key(&provider)?.ok_or_else(|| format!("No API key set for {provider}"))?;

    let client = reqwest::Client::new();
    let req = CompletionRequest {
        model: &model,
        api_key: &api_key,
        messages: &messages,
    };

    providers::stream(&client, &provider, &req, &on_delta)
        .await
        .map_err(|e| e.to_string())
}
