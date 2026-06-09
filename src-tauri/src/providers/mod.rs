//! Provider abstraction: a normalized chat request is dispatched to one of the
//! supported LLM providers, each implemented over raw HTTP (`reqwest`) with SSE
//! streaming. The Anthropic provider uses raw HTTP because there is no official
//! Rust SDK.

pub mod anthropic;
pub mod gemini;
pub mod mistral;
pub mod openai;

use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::Context;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// An image attached to a message (base64-encoded, no data: prefix).
#[derive(Debug, Clone, Deserialize)]
pub struct ImagePart {
    pub media_type: String,
    pub data: String,
}

/// A single conversation turn, as sent from the frontend.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessage {
    /// "user" | "assistant" | "system"
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<ImagePart>,
}

/// Normalized completion result returned to the frontend once streaming ends.
#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
}

/// One streamed text chunk, pushed to the frontend over a Tauri channel.
#[derive(Debug, Clone, Serialize)]
pub struct StreamDelta {
    pub text: String,
}

/// Everything a provider needs for one completion.
pub struct CompletionRequest<'a> {
    pub model: &'a str,
    pub api_key: &'a str,
    pub messages: &'a [ChatMessage],
}

/// Returns true if the user requested cancellation of the in-flight stream.
/// Threaded into each provider's SSE closure so it can early-exit (returning the
/// partially-accumulated text) the same way `message_stop` / `[DONE]` does.
pub(crate) fn is_cancelled(cancel: &AtomicBool) -> bool {
    cancel.load(Ordering::Relaxed)
}

#[allow(async_fn_in_trait)]
pub trait Provider {
    /// Stream a completion, emitting text deltas on `channel`, and return the
    /// fully-accumulated response when the stream ends. `cancel` is polled
    /// inside the SSE loop: when set, the provider stops early and returns
    /// whatever text it has accumulated so far.
    async fn stream(
        &self,
        client: &reqwest::Client,
        req: &CompletionRequest<'_>,
        channel: &Channel<StreamDelta>,
        cancel: &AtomicBool,
    ) -> anyhow::Result<ChatResponse>;
}

/// Dispatch a streaming completion to the named provider.
pub async fn stream(
    client: &reqwest::Client,
    provider: &str,
    req: &CompletionRequest<'_>,
    channel: &Channel<StreamDelta>,
    cancel: &AtomicBool,
) -> anyhow::Result<ChatResponse> {
    match provider {
        "anthropic" => {
            anthropic::Anthropic
                .stream(client, req, channel, cancel)
                .await
        }
        "openai" => openai::OpenAi.stream(client, req, channel, cancel).await,
        "mistral" => mistral::Mistral.stream(client, req, channel, cancel).await,
        "gemini" => gemini::Gemini.stream(client, req, channel, cancel).await,
        other => anyhow::bail!("unknown provider: {other}"),
    }
}

/// Read a Server-Sent Events response line by line, invoking `on_data` with the
/// payload of each `data:` line (UTF-8 safe across chunk boundaries). The
/// callback may return `Ok(false)` to stop early.
pub(crate) async fn for_each_sse_data<F>(
    resp: reqwest::Response,
    mut on_data: F,
) -> anyhow::Result<()>
where
    F: FnMut(&str) -> anyhow::Result<bool>,
{
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("reading stream chunk")?;
        buf.extend_from_slice(&chunk);

        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = std::str::from_utf8(&line[..line.len() - 1])
                .unwrap_or("")
                .trim();
            if let Some(data) = line.strip_prefix("data:") {
                if !on_data(data.trim())? {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}
