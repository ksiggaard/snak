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

/// Token usage for one completion, captured from the provider's streaming
/// response (T16). Fields are snake_case and serialized as-is — the frontend
/// reads them back verbatim (Tauri does not camelCase command *return* values
/// the way it does top-level args, but we keep them snake_case to match the DB
/// columns regardless). All counts are best-effort: a provider that omits a
/// field (or a stream cancelled before the usage event) leaves it at 0.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Usage {
    /// Prompt/input tokens (excludes cache reads/writes where reported separately).
    pub input_tokens: u64,
    /// Generated/output tokens.
    pub output_tokens: u64,
    /// Tokens used to *create* a cache entry (Anthropic `cache_creation_input_tokens`).
    pub cache_creation_tokens: u64,
    /// Tokens served *from* cache (Anthropic `cache_read_input_tokens`).
    pub cache_read_tokens: u64,
}

/// Normalized completion result returned to the frontend once streaming ends.
#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
    /// Per-response token usage parsed from the stream's usage event(s).
    pub usage: Usage,
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

/// Read a `u64` token count out of a JSON value at the given key, defaulting to
/// 0 when absent or non-numeric. Shared by the per-provider usage parsers.
pub(crate) fn u64_field(v: &serde_json::Value, key: &str) -> u64 {
    v.get(key).and_then(|n| n.as_u64()).unwrap_or(0)
}

/// Parse an Anthropic `usage` object. Anthropic splits usage across two SSE
/// events: `message_start.message.usage` carries `input_tokens` +
/// `cache_creation_input_tokens` + `cache_read_input_tokens`, and
/// `message_delta.usage` carries the final `output_tokens`. This merges
/// whichever fields are present into the running `Usage` (later events
/// overwrite earlier ones for fields they actually carry).
pub(crate) fn merge_anthropic_usage(usage: &mut Usage, obj: &serde_json::Value) {
    if let Some(n) = obj.get("input_tokens").and_then(|n| n.as_u64()) {
        usage.input_tokens = n;
    }
    if let Some(n) = obj.get("output_tokens").and_then(|n| n.as_u64()) {
        usage.output_tokens = n;
    }
    if let Some(n) = obj
        .get("cache_creation_input_tokens")
        .and_then(|n| n.as_u64())
    {
        usage.cache_creation_tokens = n;
    }
    if let Some(n) = obj.get("cache_read_input_tokens").and_then(|n| n.as_u64()) {
        usage.cache_read_tokens = n;
    }
}

/// Parse an OpenAI/Mistral `usage` object (final chunk when
/// `stream_options.include_usage` is set): `prompt_tokens` / `completion_tokens`,
/// with optional `prompt_tokens_details.cached_tokens` for cache reads.
pub(crate) fn parse_openai_usage(obj: &serde_json::Value) -> Usage {
    Usage {
        input_tokens: u64_field(obj, "prompt_tokens"),
        output_tokens: u64_field(obj, "completion_tokens"),
        cache_creation_tokens: 0,
        cache_read_tokens: obj
            .pointer("/prompt_tokens_details/cached_tokens")
            .and_then(|n| n.as_u64())
            .unwrap_or(0),
    }
}

/// Parse a Gemini `usageMetadata` object: `promptTokenCount` /
/// `candidatesTokenCount`, with optional `cachedContentTokenCount` for cache
/// reads. Gemini reports cumulative usage on each chunk, so callers replace
/// (not accumulate) — the last chunk's metadata is authoritative.
pub(crate) fn parse_gemini_usage(obj: &serde_json::Value) -> Usage {
    Usage {
        input_tokens: u64_field(obj, "promptTokenCount"),
        output_tokens: u64_field(obj, "candidatesTokenCount"),
        cache_creation_tokens: 0,
        cache_read_tokens: u64_field(obj, "cachedContentTokenCount"),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_usage_merges_across_two_events() {
        // message_start carries input + cache fields...
        let start: serde_json::Value = serde_json::from_str(
            r#"{"input_tokens":120,"cache_creation_input_tokens":30,
                "cache_read_input_tokens":900,"output_tokens":1}"#,
        )
        .unwrap();
        // ...message_delta carries the authoritative output_tokens.
        let delta: serde_json::Value = serde_json::from_str(r#"{"output_tokens":256}"#).unwrap();

        let mut usage = Usage::default();
        merge_anthropic_usage(&mut usage, &start);
        merge_anthropic_usage(&mut usage, &delta);

        assert_eq!(usage.input_tokens, 120);
        assert_eq!(usage.output_tokens, 256); // delta overwrites the start's 1
        assert_eq!(usage.cache_creation_tokens, 30);
        assert_eq!(usage.cache_read_tokens, 900);
    }

    #[test]
    fn anthropic_usage_missing_fields_default_to_zero() {
        let mut usage = Usage::default();
        merge_anthropic_usage(&mut usage, &serde_json::json!({"input_tokens": 10}));
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 0);
        assert_eq!(usage.cache_read_tokens, 0);
    }

    #[test]
    fn openai_usage_with_cached_tokens() {
        let obj: serde_json::Value = serde_json::from_str(
            r#"{"prompt_tokens":50,"completion_tokens":75,
                "prompt_tokens_details":{"cached_tokens":40}}"#,
        )
        .unwrap();
        let u = parse_openai_usage(&obj);
        assert_eq!(u.input_tokens, 50);
        assert_eq!(u.output_tokens, 75);
        assert_eq!(u.cache_read_tokens, 40);
        assert_eq!(u.cache_creation_tokens, 0);
    }

    #[test]
    fn openai_usage_without_details() {
        let obj = serde_json::json!({"prompt_tokens": 5, "completion_tokens": 6});
        let u = parse_openai_usage(&obj);
        assert_eq!(u.input_tokens, 5);
        assert_eq!(u.output_tokens, 6);
        assert_eq!(u.cache_read_tokens, 0);
    }

    #[test]
    fn gemini_usage_metadata() {
        let obj: serde_json::Value = serde_json::from_str(
            r#"{"promptTokenCount":200,"candidatesTokenCount":300,
                "cachedContentTokenCount":150,"totalTokenCount":500}"#,
        )
        .unwrap();
        let u = parse_gemini_usage(&obj);
        assert_eq!(u.input_tokens, 200);
        assert_eq!(u.output_tokens, 300);
        assert_eq!(u.cache_read_tokens, 150);
    }

    #[test]
    fn gemini_usage_without_cache() {
        let obj = serde_json::json!({"promptTokenCount": 7, "candidatesTokenCount": 8});
        let u = parse_gemini_usage(&obj);
        assert_eq!(u.input_tokens, 7);
        assert_eq!(u.output_tokens, 8);
        assert_eq!(u.cache_read_tokens, 0);
    }
}
