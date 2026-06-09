//! Google Gemini streamGenerateContent API (SSE via `?alt=sse`).
//! Roles differ: assistant -> "model", and the system prompt goes in
//! `systemInstruction` rather than the `contents` array.

use std::sync::atomic::AtomicBool;

use anyhow::{anyhow, Context};
use tauri::ipc::Channel;

use super::{
    for_each_sse_data, is_cancelled, parse_gemini_usage, ChatResponse, CompletionRequest, Provider,
    StreamDelta, Usage,
};

const BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

pub struct Gemini;

impl Provider for Gemini {
    async fn stream(
        &self,
        client: &reqwest::Client,
        req: &CompletionRequest<'_>,
        channel: &Channel<StreamDelta>,
        cancel: &AtomicBool,
    ) -> anyhow::Result<ChatResponse> {
        let mut system = String::new();
        let mut contents = Vec::new();
        for m in req.messages {
            match m.role.as_str() {
                "system" => {
                    if !system.is_empty() {
                        system.push_str("\n\n");
                    }
                    system.push_str(&m.content);
                }
                role => {
                    let gemini_role = if role == "assistant" { "model" } else { "user" };
                    let mut parts = Vec::new();
                    if !m.content.is_empty() {
                        parts.push(serde_json::json!({ "text": m.content }));
                    }
                    for img in &m.images {
                        parts.push(serde_json::json!({
                            "inline_data": {
                                "mime_type": img.media_type,
                                "data": img.data,
                            },
                        }));
                    }
                    if parts.is_empty() {
                        parts.push(serde_json::json!({ "text": "" }));
                    }
                    contents.push(serde_json::json!({
                        "role": gemini_role,
                        "parts": parts,
                    }));
                }
            }
        }

        let mut body = serde_json::json!({ "contents": contents });
        if !system.is_empty() {
            body["systemInstruction"] = serde_json::json!({
                "parts": [{ "text": system }],
            });
        }

        let url = format!("{BASE_URL}/{}:streamGenerateContent?alt=sse", req.model);
        let resp = client
            .post(url)
            .header("x-goog-api-key", req.api_key)
            .json(&body)
            .send()
            .await
            .context("gemini request failed")?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("gemini error {status}: {text}"));
        }

        let mut content = String::new();
        let mut usage = Usage::default();

        for_each_sse_data(resp, |data| {
            // Stop promptly on user cancellation, keeping the partial text.
            if is_cancelled(cancel) {
                return Ok(false);
            }
            let v: serde_json::Value = serde_json::from_str(data).context("parsing gemini SSE")?;
            // Gemini reports cumulative usage on each chunk; the last one wins.
            if let Some(u) = v.get("usageMetadata") {
                usage = parse_gemini_usage(u);
            }
            if let Some(parts) = v
                .pointer("/candidates/0/content/parts")
                .and_then(|p| p.as_array())
            {
                for part in parts {
                    if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                        content.push_str(t);
                        channel
                            .send(StreamDelta {
                                text: t.to_string(),
                            })
                            .map_err(|e| anyhow!("channel send failed: {e}"))?;
                    }
                }
            }
            Ok(true)
        })
        .await?;

        Ok(ChatResponse {
            content,
            model: req.model.to_string(),
            usage,
        })
    }
}
