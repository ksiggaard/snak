//! Anthropic Messages API (https://api.anthropic.com/v1/messages), SSE streaming.
//! Raw HTTP per the claude-api guidance (no official Rust SDK).

use std::sync::atomic::AtomicBool;

use anyhow::{anyhow, Context};
use tauri::ipc::Channel;

use super::{
    anthropic_tools, for_each_sse_data, is_cancelled, merge_anthropic_usage, ChatResponse,
    CompletionRequest, Provider, StreamDelta, ToolCall, Usage,
};

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
        cancel: &AtomicBool,
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
            } else if !m.tool_calls.is_empty() {
                // Rust-synthesized assistant turn carrying tool_use blocks (T13).
                let mut blocks = Vec::new();
                if !m.content.is_empty() {
                    blocks.push(serde_json::json!({ "type": "text", "text": m.content }));
                }
                for tc in &m.tool_calls {
                    blocks.push(serde_json::json!({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.name,
                        "input": tc.arguments,
                    }));
                }
                messages.push(serde_json::json!({ "role": "assistant", "content": blocks }));
            } else if !m.tool_results.is_empty() {
                // Rust-synthesized tool-result turn → a user turn of tool_result
                // blocks (Anthropic carries results in the user role) (T13).
                let blocks: Vec<serde_json::Value> = m
                    .tool_results
                    .iter()
                    .map(|tr| {
                        serde_json::json!({
                            "type": "tool_result",
                            "tool_use_id": tr.tool_call_id,
                            "content": tr.content,
                        })
                    })
                    .collect();
                messages.push(serde_json::json!({ "role": "user", "content": blocks }));
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
        // Only attach `tools` when there are some — keeps the tool-less request
        // byte-identical to before (T13 no-tools invariant).
        if !req.tools.is_empty() {
            body["tools"] = serde_json::Value::Array(anthropic_tools(req.tools));
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
        let mut usage = Usage::default();
        // tool_use blocks arrive as content_block_start (id+name) then a run of
        // input_json_delta partial_json fragments, keyed by block index (T13).
        let mut tool_acc: Vec<PartialToolUse> = Vec::new();

        for_each_sse_data(resp, |data| {
            // Stop promptly on user cancellation, keeping the partial text.
            if is_cancelled(cancel) {
                return Ok(false);
            }
            let v: serde_json::Value =
                serde_json::from_str(data).context("parsing anthropic SSE")?;
            match v.get("type").and_then(|t| t.as_str()) {
                Some("message_start") => {
                    if let Some(m) = v.pointer("/message/model").and_then(|m| m.as_str()) {
                        model = m.to_string();
                    }
                    // message_start.message.usage: input + cache tokens (output
                    // is a placeholder here; the real count arrives in message_delta).
                    if let Some(u) = v.pointer("/message/usage") {
                        merge_anthropic_usage(&mut usage, u);
                    }
                }
                Some("message_delta") => {
                    // message_delta.usage: the authoritative output_tokens.
                    if let Some(u) = v.get("usage") {
                        merge_anthropic_usage(&mut usage, u);
                    }
                }
                Some("content_block_start") => {
                    if let Some(block) = v.get("content_block") {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            let index = v.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                            tool_acc.push(PartialToolUse {
                                index,
                                id: block
                                    .get("id")
                                    .and_then(|i| i.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                name: block
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                json: String::new(),
                            });
                        }
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
                    } else if let Some(pj) =
                        v.pointer("/delta/partial_json").and_then(|t| t.as_str())
                    {
                        let index = v.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                        if let Some(t) = tool_acc.iter_mut().find(|t| t.index == index) {
                            t.json.push_str(pj);
                        }
                    }
                }
                Some("message_stop") => return Ok(false),
                _ => {}
            }
            Ok(true)
        })
        .await?;

        let tool_calls = tool_acc.into_iter().map(PartialToolUse::finish).collect();

        Ok(ChatResponse {
            content,
            model,
            usage,
            tool_calls,
        })
    }
}

/// Accumulator for one streamed Anthropic `tool_use` block. The id/name arrive in
/// `content_block_start`; the input is streamed as `partial_json` fragments that
/// concatenate into one JSON object.
struct PartialToolUse {
    index: u64,
    id: String,
    name: String,
    json: String,
}

impl PartialToolUse {
    fn finish(self) -> ToolCall {
        // An empty input (no fragments) means `{}`.
        let arguments = if self.json.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&self.json).unwrap_or_else(|_| serde_json::json!({}))
        };
        ToolCall {
            id: self.id,
            name: self.name,
            arguments,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_tool_use_assembles_arguments() {
        let p = PartialToolUse {
            index: 0,
            id: "toolu_1".into(),
            name: "web__fetch_url".into(),
            json: r#"{"url":"https://example.com"}"#.into(),
        };
        let call = p.finish();
        assert_eq!(call.id, "toolu_1");
        assert_eq!(call.name, "web__fetch_url");
        assert_eq!(call.arguments["url"], "https://example.com");
    }

    #[test]
    fn partial_tool_use_empty_json_defaults_to_object() {
        let p = PartialToolUse {
            index: 0,
            id: "toolu_2".into(),
            name: "noop".into(),
            json: String::new(),
        };
        assert_eq!(p.finish().arguments, serde_json::json!({}));
    }
}
