//! OpenAI Chat Completions API (SSE streaming). The request/response shape is
//! shared with Mistral via `chat_completions_stream`.

use anyhow::{anyhow, Context};
use tauri::ipc::Channel;

use super::{
    for_each_sse_data, ChatMessage, ChatResponse, CompletionRequest, Provider, StreamDelta,
};

const BASE_URL: &str = "https://api.openai.com/v1";

pub struct OpenAi;

impl Provider for OpenAi {
    async fn stream(
        &self,
        client: &reqwest::Client,
        req: &CompletionRequest<'_>,
        channel: &Channel<StreamDelta>,
    ) -> anyhow::Result<ChatResponse> {
        chat_completions_stream(
            client,
            BASE_URL,
            req.api_key,
            req.model,
            req.messages,
            channel,
        )
        .await
    }
}

/// Shared OpenAI-style streaming `POST {base}/chat/completions` with bearer
/// auth. Roles (user/assistant/system) map through unchanged.
pub(super) async fn chat_completions_stream(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    channel: &Channel<StreamDelta>,
) -> anyhow::Result<ChatResponse> {
    let msgs: Vec<_> = messages
        .iter()
        .map(|m| {
            let content = if m.images.is_empty() {
                serde_json::Value::String(m.content.clone())
            } else {
                let mut parts = Vec::new();
                if !m.content.is_empty() {
                    parts.push(serde_json::json!({
                        "type": "text",
                        "text": m.content,
                    }));
                }
                for img in &m.images {
                    parts.push(serde_json::json!({
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{};base64,{}", img.media_type, img.data),
                        },
                    }));
                }
                serde_json::Value::Array(parts)
            };
            serde_json::json!({ "role": m.role, "content": content })
        })
        .collect();

    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "messages": msgs,
    });

    let resp = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .context("chat completions request failed")?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("provider error {status}: {text}"));
    }

    let mut content = String::new();
    let mut model_out = model.to_string();

    for_each_sse_data(resp, |data| {
        if data == "[DONE]" {
            return Ok(false);
        }
        let v: serde_json::Value =
            serde_json::from_str(data).context("parsing chat completions SSE")?;
        if let Some(m) = v.get("model").and_then(|m| m.as_str()) {
            model_out = m.to_string();
        }
        if let Some(t) = v
            .pointer("/choices/0/delta/content")
            .and_then(|t| t.as_str())
        {
            content.push_str(t);
            channel
                .send(StreamDelta {
                    text: t.to_string(),
                })
                .map_err(|e| anyhow!("channel send failed: {e}"))?;
        }
        Ok(true)
    })
    .await?;

    Ok(ChatResponse {
        content,
        model: model_out,
    })
}
