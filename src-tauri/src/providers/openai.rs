//! OpenAI Chat Completions API (SSE streaming). The request/response shape is
//! shared with Mistral via `chat_completions_stream`.

use std::sync::atomic::AtomicBool;

use anyhow::{anyhow, Context};
use tauri::ipc::Channel;

use super::{
    for_each_sse_data, is_cancelled, openai_tools, parse_openai_usage, redact_trace_body,
    send_with_retry, ChatMessage, ChatResponse, CompletionRequest, Provider, StreamDelta, ToolCall,
    Usage,
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
        chat_completions_stream(client, BASE_URL, req, channel, cancel).await
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
pub(super) async fn chat_completions_stream(
    client: &reqwest::Client,
    base_url: &str,
    req: &CompletionRequest<'_>,
    channel: &Channel<StreamDelta>,
    cancel: &AtomicBool,
) -> anyhow::Result<ChatResponse> {
    let msgs = build_messages_flat(req.messages);

    let mut body = serde_json::json!({
        "model": req.model,
        "stream": true,
        // Ask for a final usage-only chunk after the content (OpenAI + Mistral).
        "stream_options": { "include_usage": true },
        "messages": msgs,
    });
    // Attach tools only when present — tool-less request stays byte-identical.
    if !req.tools.is_empty() {
        body["tools"] = serde_json::Value::Array(openai_tools(req.tools));
    }

    // Developer trace: surface the exact (redacted) request before sending.
    if req.trace {
        let _ = channel.send(StreamDelta::api_trace(
            "request",
            req.round,
            redact_trace_body(&body),
        ));
    }

    let resp = send_with_retry(
        client
            .post(format!("{base_url}/chat/completions"))
            .bearer_auth(req.api_key)
            .json(&body),
        cancel,
    )
    .await
    .context("chat completions request failed")?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("provider error {status}: {text}"));
    }

    let mut content = String::new();
    let mut model_out = req.model.to_string();
    let mut usage = Usage::default();
    // tool_calls stream as deltas keyed by `index`, each carrying an id/name
    // (first delta) then `function.arguments` string fragments (T13).
    let mut tool_acc: Vec<PartialToolCall> = Vec::new();
    // Splits inline `<think>…</think>` reasoning out of the content stream when
    // reasoning capture is on (Magistral / DeepSeek-R1 style). Inert otherwise.
    let mut splitter = ThinkSplitter::default();

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
        // Reasoning (best-effort): OpenAI-compatible reasoning backends
        // (DeepSeek, vLLM, OpenRouter, …) emit `reasoning_content` or
        // `reasoning` deltas; stock OpenAI/Mistral chat-completions don't, so
        // this is simply absent there. Gated on the capture setting.
        if req.reasoning {
            for key in ["reasoning_content", "reasoning"] {
                if let Some(r) = v
                    .pointer(&format!("/choices/0/delta/{key}"))
                    .and_then(|r| r.as_str())
                {
                    if !r.is_empty() {
                        channel
                            .send(StreamDelta::reasoning(r))
                            .map_err(|e| anyhow!("channel send failed: {e}"))?;
                    }
                }
            }
        }
        if let Some(t) = v
            .pointer("/choices/0/delta/content")
            .and_then(|t| t.as_str())
        {
            // With reasoning on, split out any inline `<think>…</think>` block
            // (Magistral / DeepSeek-R1 inline their reasoning this way) so it
            // streams to the reasoning panel, not the answer. Off → pass through.
            if req.reasoning {
                let (answer, reason) = splitter.push(t);
                if !reason.is_empty() {
                    channel
                        .send(StreamDelta::reasoning(&reason))
                        .map_err(|e| anyhow!("channel send failed: {e}"))?;
                }
                if !answer.is_empty() {
                    content.push_str(&answer);
                    channel
                        .send(StreamDelta::text(&answer))
                        .map_err(|e| anyhow!("channel send failed: {e}"))?;
                }
            } else {
                content.push_str(t);
                channel
                    .send(StreamDelta::text(t))
                    .map_err(|e| anyhow!("channel send failed: {e}"))?;
            }
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

    // Flush any tail the splitter held back (a partial tag that never completed).
    if req.reasoning {
        let (answer, reason) = splitter.finish();
        if !reason.is_empty() {
            let _ = channel.send(StreamDelta::reasoning(&reason));
        }
        if !answer.is_empty() {
            content.push_str(&answer);
            let _ = channel.send(StreamDelta::text(&answer));
        }
    }

    let tool_calls = tool_acc.into_iter().map(PartialToolCall::finish).collect();

    Ok(ChatResponse {
        content,
        model: model_out,
        usage,
        tool_calls,
        thinking_blocks: Vec::new(),
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

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

/// Streaming splitter that separates an assistant message into answer text and
/// reasoning by detecting `<think>…</think>` blocks — Magistral and
/// DeepSeek-R1-style models inline their reasoning that way. Stateful across
/// deltas and resilient to a tag split across chunk boundaries: it holds back
/// only the longest tail that could be the start of the tag it's looking for.
#[derive(Default)]
struct ThinkSplitter {
    in_think: bool,
    buf: String,
}

impl ThinkSplitter {
    /// Feed one content delta; returns `(answer_chunk, reasoning_chunk)` ready to
    /// emit now (either may be empty). Buffers a possible partial tag at the tail.
    fn push(&mut self, text: &str) -> (String, String) {
        self.buf.push_str(text);
        let mut answer = String::new();
        let mut reasoning = String::new();
        loop {
            let needle = if self.in_think {
                THINK_CLOSE
            } else {
                THINK_OPEN
            };
            if let Some(pos) = self.buf.find(needle) {
                // Tag boundaries are ASCII, so `pos` is a valid char boundary.
                let sink = if self.in_think {
                    &mut reasoning
                } else {
                    &mut answer
                };
                sink.push_str(&self.buf[..pos]);
                self.buf.drain(..pos + needle.len());
                self.in_think = !self.in_think;
            } else {
                let keep = partial_tag_tail(&self.buf, needle);
                let emit_to = self.buf.len() - keep;
                let sink = if self.in_think {
                    &mut reasoning
                } else {
                    &mut answer
                };
                sink.push_str(&self.buf[..emit_to]);
                self.buf.drain(..emit_to);
                break;
            }
        }
        (answer, reasoning)
    }

    /// Flush any buffered tail at stream end (it was a partial tag that never
    /// completed, so it's literal text in whichever section we were in).
    fn finish(self) -> (String, String) {
        if self.buf.is_empty() {
            (String::new(), String::new())
        } else if self.in_think {
            (String::new(), self.buf)
        } else {
            (self.buf, String::new())
        }
    }
}

/// Length (in bytes) of the longest suffix of `buf` that is a prefix of
/// `needle`, so it might be the start of a tag split across chunks. `needle` is
/// ASCII, so the returned boundary is always a valid char boundary. Pure / tested.
fn partial_tag_tail(buf: &str, needle: &str) -> usize {
    let max = needle.len().min(buf.len());
    for len in (1..=max).rev() {
        if needle
            .as_bytes()
            .starts_with(&buf.as_bytes()[buf.len() - len..])
        {
            return len;
        }
    }
    0
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
            thinking_blocks: vec![],
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
            thinking_blocks: vec![],
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
            thinking_blocks: vec![],
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

    /// Drive a splitter with a sequence of deltas; return the concatenated
    /// (answer, reasoning) including the final flush.
    fn run_splitter(chunks: &[&str]) -> (String, String) {
        let mut s = ThinkSplitter::default();
        let mut answer = String::new();
        let mut reasoning = String::new();
        for c in chunks {
            let (a, r) = s.push(c);
            answer.push_str(&a);
            reasoning.push_str(&r);
        }
        let (a, r) = s.finish();
        answer.push_str(&a);
        reasoning.push_str(&r);
        (answer, reasoning)
    }

    #[test]
    fn think_splitter_separates_reasoning_from_answer() {
        let (answer, reasoning) =
            run_splitter(&["<think>weighing options</think>The answer is 42."]);
        assert_eq!(reasoning, "weighing options");
        assert_eq!(answer, "The answer is 42.");
    }

    #[test]
    fn think_splitter_handles_tags_split_across_chunks() {
        // Tags arrive byte-fragmented across deltas.
        let (answer, reasoning) = run_splitter(&["<thi", "nk>rea", "soning</thi", "nk>fin", "al"]);
        assert_eq!(reasoning, "reasoning");
        assert_eq!(answer, "final");
    }

    #[test]
    fn think_splitter_passes_through_plain_content() {
        // No tags: everything is the answer, even with a stray '<'.
        let (answer, reasoning) = run_splitter(&["a < b and ", "c > d"]);
        assert_eq!(answer, "a < b and c > d");
        assert_eq!(reasoning, "");
    }

    #[test]
    fn think_splitter_flushes_unterminated_think() {
        // A think block with no closing tag flushes as reasoning at stream end.
        let (answer, reasoning) = run_splitter(&["<think>still thinking"]);
        assert_eq!(answer, "");
        assert_eq!(reasoning, "still thinking");
    }

    #[test]
    fn think_splitter_is_utf8_safe_at_tag_boundary() {
        // Multibyte chars adjacent to a partial-tag tail must not panic.
        let (answer, reasoning) = run_splitter(&["café <", "think>π</think> δ"]);
        assert_eq!(answer, "café  δ");
        assert_eq!(reasoning, "π");
    }

    #[test]
    fn partial_tag_tail_finds_prefixes() {
        assert_eq!(partial_tag_tail("foo<", THINK_OPEN), 1);
        assert_eq!(partial_tag_tail("foo<thi", THINK_OPEN), 4);
        assert_eq!(partial_tag_tail("foobar", THINK_OPEN), 0);
        // A multibyte tail can't match the ASCII needle → 0 (no panic).
        assert_eq!(partial_tag_tail("café", THINK_OPEN), 0);
    }
}
