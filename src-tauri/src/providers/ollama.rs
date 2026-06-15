//! Local Ollama daemon (T37). **Endpoint decision:** chat goes through Ollama's
//! OpenAI-compatible `/v1/chat/completions` endpoint, reusing the shared
//! `openai::chat_completions_stream` driver exactly like Mistral does.
//! Discovery/health use the **native** API (`/api/tags`, `/api/version`)
//! instead, because it is richer (model size / modified date) and the compat
//! layer adds nothing there.
//!
//! Usage capture is free: the compat layer maps Ollama's `prompt_eval_count` /
//! `eval_count` onto `prompt_tokens` / `completion_tokens`, and the shared
//! driver already sends `stream_options.include_usage` — so the standard
//! OpenAI usage parsing applies as-is. Cache fields stay 0 (Ollama reports
//! no cache counters).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use anyhow::{anyhow, Context};
use serde_json::{json, Value};
use tauri::ipc::Channel;

use super::{
    for_each_line, is_cancelled, openai_tools, redact_trace_body, u64_field, ChatMessage,
    ChatResponse, CompletionRequest, Provider, StreamDelta, ToolCall, Usage,
};

/// Where the local Ollama daemon listens by default.
pub(crate) const BASE_URL: &str = "http://localhost:11434";

/// Context window (`num_ctx`) requested for every chat. Ollama's default is
/// small (often 2k–4k) and silently truncates from the *front* when exceeded —
/// which drops the system prompt and the user's question once a tool result is
/// appended, leaving a small model to answer with a generic greeting. A roomier
/// window keeps the question in context. Set via the native `/api/chat`
/// endpoint's `options` (the OpenAI-compat `/v1` endpoint can't set it).
const NUM_CTX: u64 = 8192;

/// Monotonic counter giving each streamed tool call a process-unique id. Native
/// Ollama tool calls carry no id of their own; a per-response index would
/// collide across the chat loop's rounds (each `stream()` starts fresh), so the
/// frontend would merge two rounds' panels. A global counter avoids that.
static TOOL_CALL_SEQ: AtomicU64 = AtomicU64::new(0);

pub struct Ollama;

impl Provider for Ollama {
    async fn stream(
        &self,
        client: &reqwest::Client,
        req: &CompletionRequest<'_>,
        channel: &Channel<StreamDelta>,
        cancel: &AtomicBool,
    ) -> anyhow::Result<ChatResponse> {
        native_chat(client, req, channel, cancel)
            .await
            .map_err(friendly_connect_error)
    }
}

/// Stream a completion from Ollama's **native** `/api/chat` endpoint. Unlike the
/// OpenAI-compat `/v1` path (which Mistral shares), this lets us set `num_ctx`
/// via `options`, and parses Ollama's newline-delimited JSON stream rather than
/// SSE. Tool calls arrive complete in a single `message.tool_calls` (not as
/// incremental deltas), so no accumulator is needed.
async fn native_chat(
    client: &reqwest::Client,
    req: &CompletionRequest<'_>,
    channel: &Channel<StreamDelta>,
    cancel: &AtomicBool,
) -> anyhow::Result<ChatResponse> {
    let mut body = json!({
        "model": req.model,
        "stream": true,
        "messages": build_native_messages(req.messages),
        "options": { "num_ctx": NUM_CTX },
    });
    // Attach tools only when present — keeps the tool-less request minimal.
    if !req.tools.is_empty() {
        body["tools"] = Value::Array(openai_tools(req.tools));
    }
    // Reasoning capture: ask the native API to stream the model's thinking in a
    // separate `message.thinking` field (thinking-capable local models only).
    if req.reasoning {
        body["think"] = Value::Bool(true);
    }

    // Developer trace: surface the exact (redacted) request before sending.
    if req.trace {
        let _ = channel.send(StreamDelta::api_trace(
            "request",
            req.round,
            redact_trace_body(&body),
        ));
    }

    let mut resp = client
        .post(format!("{BASE_URL}/api/chat"))
        .json(&body)
        .send()
        .await
        .context("ollama chat request failed")?;

    // Resilience: `think: true` errors on models that don't support thinking
    // (e.g. gemma3, qwen2.5). Rather than let an enabled global setting break
    // chat for non-thinking local models, drop `think` and retry once.
    if !resp.status().is_success() && req.reasoning {
        if let Some(obj) = body.as_object_mut() {
            obj.remove("think");
        }
        resp = client
            .post(format!("{BASE_URL}/api/chat"))
            .json(&body)
            .send()
            .await
            .context("ollama chat request failed")?;
    }

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("ollama error {status}: {text}"));
    }

    let mut content = String::new();
    let mut model_out = req.model.to_string();
    let mut usage = Usage::default();
    let mut tool_calls: Vec<ToolCall> = Vec::new();

    for_each_line(resp, |line| {
        if is_cancelled(cancel) {
            return Ok(false);
        }
        let v: Value = serde_json::from_str(line).context("parsing ollama chat stream")?;
        if let Some(m) = v.get("model").and_then(|m| m.as_str()) {
            model_out = m.to_string();
        }
        // Native `think: true` streams reasoning in a separate `thinking` field.
        if req.reasoning {
            if let Some(r) = v.pointer("/message/thinking").and_then(|t| t.as_str()) {
                if !r.is_empty() {
                    channel
                        .send(StreamDelta::reasoning(r))
                        .map_err(|e| anyhow!("channel send failed: {e}"))?;
                }
            }
        }
        if let Some(t) = v.pointer("/message/content").and_then(|t| t.as_str()) {
            if !t.is_empty() {
                content.push_str(t);
                channel
                    .send(StreamDelta::text(t))
                    .map_err(|e| anyhow!("channel send failed: {e}"))?;
            }
        }
        if let Some(calls) = v.pointer("/message/tool_calls").and_then(|c| c.as_array()) {
            for call in calls {
                let name = call
                    .pointer("/function/name")
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string();
                let arguments = call
                    .pointer("/function/arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let id = format!("ollama-{}", TOOL_CALL_SEQ.fetch_add(1, Ordering::Relaxed));
                tool_calls.push(ToolCall {
                    id,
                    name,
                    arguments,
                });
            }
        }
        // The final message carries `done: true` plus the token counts.
        if v.get("done").and_then(|d| d.as_bool()) == Some(true) {
            usage.input_tokens = u64_field(&v, "prompt_eval_count");
            usage.output_tokens = u64_field(&v, "eval_count");
            return Ok(false);
        }
        Ok(true)
    })
    .await?;

    Ok(ChatResponse {
        content,
        model: model_out,
        usage,
        tool_calls,
        thinking_blocks: Vec::new(),
    })
}

/// Build the native `/api/chat` `messages` array from our `ChatMessage`s,
/// including the Rust-synthesized assistant tool-call turns and `tool` result
/// turns. Native Ollama carries tool-call arguments as a JSON *object* (not a
/// string, as the OpenAI shape does) and results as `tool` role messages keyed
/// by `tool_name`. Pure / unit-tested.
fn build_native_messages(messages: &[ChatMessage]) -> Vec<Value> {
    let mut out = Vec::new();
    for m in messages {
        if !m.tool_calls.is_empty() {
            let calls: Vec<Value> = m
                .tool_calls
                .iter()
                .map(|tc| {
                    json!({
                        "function": { "name": tc.name, "arguments": tc.arguments }
                    })
                })
                .collect();
            let mut turn = json!({ "role": "assistant", "tool_calls": calls });
            if !m.content.is_empty() {
                turn["content"] = Value::String(m.content.clone());
            }
            out.push(turn);
        } else if !m.tool_results.is_empty() {
            // One `tool` message per result (native uses `tool_name`, not an id).
            for tr in &m.tool_results {
                out.push(json!({
                    "role": "tool",
                    "tool_name": tr.name,
                    "content": tr.content,
                }));
            }
        } else {
            let mut turn = json!({ "role": m.role, "content": m.content });
            if !m.images.is_empty() {
                // Native images: a bare base64 array on the message.
                let imgs: Vec<Value> = m
                    .images
                    .iter()
                    .map(|i| Value::String(i.data.clone()))
                    .collect();
                turn["images"] = Value::Array(imgs);
            }
            out.push(turn);
        }
    }
    out
}

/// If the error chain contains a reqwest *connect* failure (daemon not
/// running), wrap it in a friendly "is Ollama running?" message, keeping the
/// original error as context. Any other error passes through unchanged.
pub(crate) fn friendly_connect_error(e: anyhow::Error) -> anyhow::Error {
    let is_connect = e
        .chain()
        .any(|c| matches!(c.downcast_ref::<reqwest::Error>(), Some(r) if r.is_connect()));
    if is_connect {
        e.context(format!(
            "Ollama isn't reachable at {BASE_URL} — is it installed and running?"
        ))
    } else {
        e
    }
}

/// One locally-installed model, from the native `/api/tags` listing.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OllamaModel {
    pub name: String,
    /// On-disk size in bytes.
    pub size: u64,
    /// RFC 3339 timestamp of the last modification (pull/update).
    pub modified_at: String,
}

/// Parse the native `/api/tags` response (`{"models":[{name,size,modified_at,…}]}`)
/// into the fields the UI shows. Tolerant: missing fields fall back to
/// defaults; anything that isn't the expected shape yields an empty list.
/// Pure / unit-tested.
pub(crate) fn parse_tags(v: &serde_json::Value) -> Vec<OllamaModel> {
    v.get("models")
        .and_then(|m| m.as_array())
        .map(|models| {
            models
                .iter()
                .map(|m| OllamaModel {
                    name: m
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    size: u64_field(m, "size"),
                    modified_at: m
                        .get("modified_at")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// GET `/api/version` → the daemon's version string (doubles as a health probe).
pub async fn fetch_version(client: &reqwest::Client) -> anyhow::Result<String> {
    let v: serde_json::Value = client
        .get(format!("{BASE_URL}/api/version"))
        .send()
        .await
        .context("ollama version request failed")?
        .error_for_status()
        .context("ollama version request failed")?
        .json()
        .await
        .context("parsing ollama version response")?;
    v.get("version")
        .and_then(|s| s.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("ollama version response missing `version`"))
}

/// GET `/api/tags` → the locally-installed models.
pub async fn fetch_models(client: &reqwest::Client) -> anyhow::Result<Vec<OllamaModel>> {
    let v: serde_json::Value = client
        .get(format!("{BASE_URL}/api/tags"))
        .send()
        .await
        .context("ollama tags request failed")?
        .error_for_status()
        .context("ollama tags request failed")?
        .json()
        .await
        .context("parsing ollama tags response")?;
    Ok(parse_tags(&v))
}

/// One model currently loaded in memory, from the native `/api/ps` listing
/// (T41). Distinct from `OllamaModel` (installed-on-disk): these are the
/// models the daemon has resident and serving right now.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OllamaRunningModel {
    pub name: String,
    /// Bytes resident in VRAM/RAM for this model right now.
    pub size_vram: u64,
    /// RFC 3339 timestamp when the daemon will unload it (keep-alive expiry).
    pub expires_at: String,
}

/// Parse the native `/api/ps` response (`{"models":[{name,size_vram,expires_at,…}]}`)
/// into the running-model fields the UI shows. Same tolerance contract as
/// `parse_tags`. Pure / unit-tested.
pub(crate) fn parse_ps(v: &serde_json::Value) -> Vec<OllamaRunningModel> {
    v.get("models")
        .and_then(|m| m.as_array())
        .map(|models| {
            models
                .iter()
                .map(|m| OllamaRunningModel {
                    name: m
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    size_vram: u64_field(m, "size_vram"),
                    expires_at: m
                        .get("expires_at")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// GET `/api/ps` → the models currently loaded in memory.
pub async fn fetch_running(client: &reqwest::Client) -> anyhow::Result<Vec<OllamaRunningModel>> {
    let v: serde_json::Value = client
        .get(format!("{BASE_URL}/api/ps"))
        .send()
        .await
        .context("ollama ps request failed")?
        .error_for_status()
        .context("ollama ps request failed")?
        .json()
        .await
        .context("parsing ollama ps response")?;
    Ok(parse_ps(&v))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{ImagePart, ToolResult};

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.into(),
            content: content.into(),
            images: vec![],
            tool_calls: vec![],
            tool_results: vec![],
            thinking_blocks: vec![],
        }
    }

    #[test]
    fn native_plain_turn_maps_role_and_content() {
        let out = build_native_messages(&[msg("user", "hi")]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["role"], "user");
        assert_eq!(out[0]["content"], "hi");
        assert!(out[0].get("tool_calls").is_none());
    }

    #[test]
    fn native_assistant_tool_call_carries_object_arguments() {
        let mut m = msg("assistant", "");
        m.tool_calls = vec![ToolCall {
            id: "ollama-0".into(),
            name: "sys__run_diagnostic".into(),
            arguments: json!({ "probe": "processes" }),
        }];
        let out = build_native_messages(&[m]);
        assert_eq!(out[0]["role"], "assistant");
        assert_eq!(
            out[0]["tool_calls"][0]["function"]["name"],
            "sys__run_diagnostic"
        );
        // Arguments are a JSON object on the native wire (not a string).
        assert!(out[0]["tool_calls"][0]["function"]["arguments"].is_object());
        assert_eq!(
            out[0]["tool_calls"][0]["function"]["arguments"]["probe"],
            "processes"
        );
    }

    #[test]
    fn native_tool_results_become_tool_role_messages() {
        let mut m = msg("tool", "");
        m.tool_results = vec![
            ToolResult {
                tool_call_id: "ollama-0".into(),
                name: "a".into(),
                content: "r1".into(),
            },
            ToolResult {
                tool_call_id: "ollama-1".into(),
                name: "b".into(),
                content: "r2".into(),
            },
        ];
        let out = build_native_messages(&[m]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["role"], "tool");
        assert_eq!(out[0]["tool_name"], "a");
        assert_eq!(out[0]["content"], "r1");
        assert_eq!(out[1]["tool_name"], "b");
    }

    #[test]
    fn native_user_images_become_base64_array() {
        let mut m = msg("user", "look");
        m.images = vec![ImagePart {
            media_type: "image/png".into(),
            data: "QQ==".into(),
        }];
        let out = build_native_messages(&[m]);
        assert_eq!(out[0]["images"][0], "QQ==");
    }

    #[test]
    fn parses_a_realistic_tags_payload() {
        let v = serde_json::json!({
            "models": [
                {
                    "name": "llama3.2:1b",
                    "model": "llama3.2:1b",
                    "modified_at": "2026-06-01T10:00:00.000000000+02:00",
                    "size": 1321098329u64,
                    "digest": "baf6a787fdff"
                },
                {
                    "name": "qwen2.5-coder:7b",
                    "modified_at": "2026-05-20T09:30:00.000000000+02:00",
                    "size": 4683087332u64
                }
            ]
        });
        let models = parse_tags(&v);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].name, "llama3.2:1b");
        assert_eq!(models[0].size, 1321098329);
        assert_eq!(models[0].modified_at, "2026-06-01T10:00:00.000000000+02:00");
        assert_eq!(models[1].name, "qwen2.5-coder:7b");
        assert_eq!(models[1].size, 4683087332);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let v = serde_json::json!({ "models": [{ "name": "tiny" }] });
        let models = parse_tags(&v);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "tiny");
        assert_eq!(models[0].size, 0);
        assert_eq!(models[0].modified_at, "");
    }

    #[test]
    fn empty_models_list_yields_empty_vec() {
        let v = serde_json::json!({ "models": [] });
        assert!(parse_tags(&v).is_empty());
    }

    #[test]
    fn parses_a_realistic_ps_payload() {
        let v = serde_json::json!({
            "models": [
                {
                    "name": "llama3.2:1b",
                    "model": "llama3.2:1b",
                    "size": 1600000000u64,
                    "size_vram": 1600000000u64,
                    "expires_at": "2026-06-13T10:05:00Z",
                    "digest": "baf6a787fdff"
                }
            ]
        });
        let running = parse_ps(&v);
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].name, "llama3.2:1b");
        assert_eq!(running[0].size_vram, 1600000000);
        assert_eq!(running[0].expires_at, "2026-06-13T10:05:00Z");
    }

    #[test]
    fn ps_missing_fields_fall_back_to_defaults() {
        let v = serde_json::json!({ "models": [{ "name": "tiny" }] });
        let running = parse_ps(&v);
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].name, "tiny");
        assert_eq!(running[0].size_vram, 0);
        assert_eq!(running[0].expires_at, "");
    }

    #[test]
    fn ps_garbage_payload_yields_empty_vec() {
        assert!(parse_ps(&serde_json::json!("nope")).is_empty());
        assert!(parse_ps(&serde_json::json!({ "models": 3 })).is_empty());
        assert!(parse_ps(&serde_json::json!(null)).is_empty());
    }

    #[test]
    fn garbage_payload_yields_empty_vec() {
        assert!(parse_tags(&serde_json::json!("not an object")).is_empty());
        assert!(parse_tags(&serde_json::json!({ "models": "nope" })).is_empty());
        assert!(parse_tags(&serde_json::json!(null)).is_empty());
    }

    #[test]
    fn non_connect_errors_pass_through_unchanged() {
        let e = friendly_connect_error(anyhow!("provider error 404: no such model"));
        assert_eq!(e.to_string(), "provider error 404: no such model");
    }

    #[tokio::test]
    async fn connect_failure_gets_the_friendly_message() {
        // Bind to an ephemeral port and drop the listener so a connection to
        // it is refused — producing a genuine reqwest connect error.
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let err = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/"))
            .send()
            .await
            .expect_err("connection should be refused");
        let wrapped = friendly_connect_error(anyhow::Error::new(err).context("request failed"));
        assert!(
            wrapped.to_string().contains("Ollama isn't reachable"),
            "got: {wrapped}"
        );
        // The original error stays in the chain as context.
        assert!(wrapped.chain().count() >= 2);
    }
}
