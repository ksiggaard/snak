//! OpenAI Chat Completions API (SSE streaming). The request/response shape is
//! shared with Mistral via `chat_completions_stream`.

use std::sync::atomic::AtomicBool;

use anyhow::{anyhow, Context};
use tauri::ipc::Channel;

use super::{
    for_each_sse_data, is_cancelled, openai_tools, parse_openai_usage, ChatMessage, ChatResponse,
    CompletionRequest, Provider, StreamDelta, ToolCall, ToolDef, Usage,
};

const BASE_URL: &str = "https://api.openai.com/v1";

pub struct OpenAi;

impl Provider for OpenAi {
    async fn stream(
        &self,
        client: &reqwest::Client,
        req: &CompletionRequest<'_>,
        channel: &Channel<StreamDelta>,
        cancel: &AtomicBool,
    ) -> anyhow::Result<ChatResponse> {
        chat_completions_stream(
            client,
            BASE_URL,
            req.api_key,
            req.model,
            req.messages,
            req.tools,
            channel,
            cancel,
        )
        .await
    }
}

/// Build the OpenAI chat-completions `messages` array from our `ChatMessage`s,
/// including the Rust-synthesized assistant tool-call turns and `tool` result
/// turns (T13). Pure / unit-tested.
pub(super) fn build_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|m| {
            if !m.tool_calls.is_empty() {
                // assistant turn with tool_calls
                let calls: Vec<serde_json::Value> = m
                    .tool_calls
                    .iter()
                    .map(|tc| {
                        serde_json::json!({
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": tc.arguments.to_string(),
                            }
                        })
                    })
                    .collect();
                let mut turn = serde_json::json!({ "role": "assistant", "tool_calls": calls });
                if !m.content.is_empty() {
                    turn["content"] = serde_json::Value::String(m.content.clone());
                }
                turn
            } else if !m.tool_results.is_empty() {
                // A turn with tool_results must be expanded into one `tool`
                // message per result — use `build_messages_flat`, not this 1:1
                // mapper. Emitting the first keeps this branch total; the flat
                // builder is what the request path actually calls.
                let tr = &m.tool_results[0];
                serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tr.tool_call_id,
                    "content": tr.content,
                })
            } else {
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
            }
        })
        .collect()
}

/// Like `build_messages` but emits one `tool` message *per* tool result (OpenAI
/// requires a separate `tool` message for each `tool_call_id`). Pure / tested.
fn build_messages_flat(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for m in messages {
        if !m.tool_results.is_empty() {
            for tr in &m.tool_results {
                out.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tr.tool_call_id,
                    "content": tr.content,
                }));
            }
        } else {
            // Reuse the 1:1 mapping for every other turn shape.
            out.extend(build_messages(std::slice::from_ref(m)));
        }
    }
    out
}

/// Shared OpenAI-style streaming `POST {base}/chat/completions` with bearer
/// auth. Roles (user/assistant/system/tool) map through; tool calls round-trip.
#[allow(clippy::too_many_arguments)]
pub(super) async fn chat_completions_stream(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolDef],
    channel: &Channel<StreamDelta>,
    cancel: &AtomicBool,
) -> anyhow::Result<ChatResponse> {
    let msgs = build_messages_flat(messages);

    let mut body = serde_json::json!({
        "model": model,
        "stream": true,
        // Ask for a final usage-only chunk after the content (OpenAI + Mistral).
        "stream_options": { "include_usage": true },
        "messages": msgs,
    });
    // Attach tools only when present — tool-less request stays byte-identical.
    if !tools.is_empty() {
        body["tools"] = serde_json::Value::Array(openai_tools(tools));
    }

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
    let mut usage = Usage::default();
    // tool_calls stream as deltas keyed by `index`, each carrying an id/name
    // (first delta) then `function.arguments` string fragments (T13).
    let mut tool_acc: Vec<PartialToolCall> = Vec::new();

    for_each_sse_data(resp, |data| {
        // Stop promptly on user cancellation, keeping the partial text.
        if is_cancelled(cancel) {
            return Ok(false);
        }
        if data == "[DONE]" {
            return Ok(false);
        }
        let v: serde_json::Value =
            serde_json::from_str(data).context("parsing chat completions SSE")?;
        if let Some(m) = v.get("model").and_then(|m| m.as_str()) {
            model_out = m.to_string();
        }
        // The include_usage final chunk has an empty `choices` array and a
        // populated top-level `usage` object; intermediate chunks have `usage:
        // null`. Capture it whenever present.
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            usage = parse_openai_usage(u);
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
        if let Some(calls) = v
            .pointer("/choices/0/delta/tool_calls")
            .and_then(|c| c.as_array())
        {
            for call in calls {
                accumulate_tool_call(&mut tool_acc, call);
            }
        }
        Ok(true)
    })
    .await?;

    let tool_calls = tool_acc.into_iter().map(PartialToolCall::finish).collect();

    Ok(ChatResponse {
        content,
        model: model_out,
        usage,
        tool_calls,
    })
}

/// Accumulator for one streamed OpenAI `tool_calls` entry, keyed by `index`.
struct PartialToolCall {
    index: u64,
    id: String,
    name: String,
    args: String,
}

impl PartialToolCall {
    fn finish(self) -> ToolCall {
        let arguments = if self.args.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&self.args).unwrap_or_else(|_| serde_json::json!({}))
        };
        ToolCall {
            id: self.id,
            name: self.name,
            arguments,
        }
    }
}

/// Merge one streamed `tool_calls` delta into the accumulator. The first delta
/// for an index carries `id`/`function.name`; subsequent ones append
/// `function.arguments` fragments. Pure (mutates the vec) / unit-tested.
fn accumulate_tool_call(acc: &mut Vec<PartialToolCall>, call: &serde_json::Value) {
    let index = call.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
    let entry = match acc.iter_mut().find(|e| e.index == index) {
        Some(e) => e,
        None => {
            acc.push(PartialToolCall {
                index,
                id: String::new(),
                name: String::new(),
                args: String::new(),
            });
            acc.last_mut().unwrap()
        }
    };
    if let Some(id) = call.get("id").and_then(|i| i.as_str()) {
        if !id.is_empty() {
            entry.id = id.to_string();
        }
    }
    if let Some(name) = call.pointer("/function/name").and_then(|n| n.as_str()) {
        if !name.is_empty() {
            entry.name = name.to_string();
        }
    }
    if let Some(args) = call.pointer("/function/arguments").and_then(|a| a.as_str()) {
        entry.args.push_str(args);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{ToolCall as TC, ToolResult};

    fn user(content: &str) -> ChatMessage {
        ChatMessage {
            role: "user".into(),
            content: content.into(),
            images: vec![],
            tool_calls: vec![],
            tool_results: vec![],
        }
    }

    #[test]
    fn accumulates_streamed_tool_call() {
        let mut acc = Vec::new();
        accumulate_tool_call(
            &mut acc,
            &serde_json::json!({
                "index": 0, "id": "call_1",
                "function": { "name": "web__fetch_url", "arguments": "{\"url\":" }
            }),
        );
        accumulate_tool_call(
            &mut acc,
            &serde_json::json!({
                "index": 0,
                "function": { "arguments": "\"https://x.com\"}" }
            }),
        );
        assert_eq!(acc.len(), 1);
        let call = acc.into_iter().next().unwrap().finish();
        assert_eq!(call.id, "call_1");
        assert_eq!(call.name, "web__fetch_url");
        assert_eq!(call.arguments["url"], "https://x.com");
    }

    #[test]
    fn assistant_tool_call_turn_maps_to_tool_calls_field() {
        let msg = ChatMessage {
            role: "assistant".into(),
            content: String::new(),
            images: vec![],
            tool_calls: vec![TC {
                id: "call_1".into(),
                name: "web__fetch_url".into(),
                arguments: serde_json::json!({ "url": "https://x.com" }),
            }],
            tool_results: vec![],
        };
        let out = build_messages_flat(&[msg]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["role"], "assistant");
        assert_eq!(out[0]["tool_calls"][0]["id"], "call_1");
        assert_eq!(
            out[0]["tool_calls"][0]["function"]["name"],
            "web__fetch_url"
        );
        // arguments is a JSON *string*, per the OpenAI wire shape.
        assert!(out[0]["tool_calls"][0]["function"]["arguments"].is_string());
    }

    #[test]
    fn tool_results_expand_to_one_tool_message_each() {
        let msg = ChatMessage {
            role: "tool".into(),
            content: String::new(),
            images: vec![],
            tool_calls: vec![],
            tool_results: vec![
                ToolResult {
                    tool_call_id: "call_1".into(),
                    name: "a".into(),
                    content: "r1".into(),
                },
                ToolResult {
                    tool_call_id: "call_2".into(),
                    name: "b".into(),
                    content: "r2".into(),
                },
            ],
        };
        let out = build_messages_flat(&[msg]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["role"], "tool");
        assert_eq!(out[0]["tool_call_id"], "call_1");
        assert_eq!(out[1]["tool_call_id"], "call_2");
    }

    #[test]
    fn plain_user_turn_unchanged() {
        let out = build_messages_flat(&[user("hi")]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["role"], "user");
        assert_eq!(out[0]["content"], "hi");
        assert!(out[0].get("tool_calls").is_none());
    }
}
