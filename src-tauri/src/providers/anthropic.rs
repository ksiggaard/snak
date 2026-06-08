//! Anthropic Messages API (https://api.anthropic.com/v1/messages), SSE streaming.
//! Raw HTTP per the claude-api guidance (no official Rust SDK).

use anyhow::{anyhow, Context};
use tauri::ipc::Channel;

use super::{for_each_sse_data, ChatResponse, CompletionRequest, Provider, StreamDelta};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 4096;

pub struct Anthropic;

impl Provider for Anthropic {
    async fn stream(
        &self,
        client: &reqwest::Client,
        req: &CompletionRequest<'_>,
        channel: &Channel<StreamDelta>,
    ) -> anyhow::Result<ChatResponse> {
        // Anthropic takes the system prompt as a top-level field; only
        // user/assistant turns belong in `messages`.
        let mut system = String::new();
        let mut messages = Vec::new();
        for m in req.messages {
            if m.role == "system" {
                if !system.is_empty() {
                    system.push_str("\n\n");
                }
                system.push_str(&m.content);
            } else {
                let content = if m.images.is_empty() {
                    serde_json::Value::String(m.content.clone())
                } else {
                    let mut blocks = Vec::new();
                    if !m.content.is_empty() {
                        blocks.push(serde_json::json!({
                            "type": "text",
                            "text": m.content,
                        }));
                    }
                    for img in &m.images {
                        blocks.push(serde_json::json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": img.media_type,
                                "data": img.data,
                            },
                        }));
                    }
                    serde_json::Value::Array(blocks)
                };
                messages.push(serde_json::json!({
                    "role": m.role,
                    "content": content,
                }));
            }
        }

        let mut body = serde_json::json!({
            "model": req.model,
            "max_tokens": MAX_TOKENS,
            "stream": true,
            "messages": messages,
        });
        if !system.is_empty() {
            body["system"] = serde_json::Value::String(system);
        }

        let resp = client
            .post(API_URL)
            .header("x-api-key", req.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&body)
            .send()
            .await
            .context("anthropic request failed")?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("anthropic error {status}: {text}"));
        }

        let mut content = String::new();
        let mut model = req.model.to_string();

        for_each_sse_data(resp, |data| {
            let v: serde_json::Value =
                serde_json::from_str(data).context("parsing anthropic SSE")?;
            match v.get("type").and_then(|t| t.as_str()) {
                Some("message_start") => {
                    if let Some(m) = v.pointer("/message/model").and_then(|m| m.as_str()) {
                        model = m.to_string();
                    }
                }
                Some("content_block_delta") => {
                    if let Some(t) = v.pointer("/delta/text").and_then(|t| t.as_str()) {
                        content.push_str(t);
                        channel
                            .send(StreamDelta {
                                text: t.to_string(),
                            })
                            .map_err(|e| anyhow!("channel send failed: {e}"))?;
                    }
                }
                Some("message_stop") => return Ok(false),
                _ => {}
            }
            Ok(true)
        })
        .await?;

        Ok(ChatResponse { content, model })
    }
}
