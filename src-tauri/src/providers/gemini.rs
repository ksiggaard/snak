//! Google Gemini streamGenerateContent API (SSE via `?alt=sse`).
//! Roles differ: assistant -> "model", and the system prompt goes in
//! `systemInstruction` rather than the `contents` array.

use std::sync::atomic::AtomicBool;

use anyhow::{anyhow, Context};
use tauri::ipc::Channel;

use super::{
    for_each_sse_data, gemini_tools, is_cancelled, parse_gemini_usage, redact_trace_body,
    send_with_retry, ChatResponse, CompletionRequest, Provider, StreamDelta, ToolCall, Usage,
};

/// Official API root (the `/v1beta/models` collection); used when a provider
/// configures no (or an empty) base URL. The `{model}:streamGenerateContent`
/// path is appended, so a preset or a Gemini-compatible proxy can override it.
const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Build the streaming generateContent URL for a (possibly empty/None) configured
/// base, defaulting to the official models root and trimming a trailing slash.
/// Pure / unit-tested.
fn generate_url(base: Option<&str>, model: &str) -> String {
    let base = base.filter(|s| !s.is_empty()).unwrap_or(DEFAULT_BASE_URL);
    format!(
        "{}/{}:streamGenerateContent?alt=sse",
        base.trim_end_matches('/'),
        model
    )
}

/// Strip JSON-Schema keywords that Gemini's `responseSchema` (a restricted
/// OpenAPI subset) rejects — `additionalProperties`, `$schema`, `strict` —
/// recursively, so a single canonical plan schema works across all providers.
/// Pure / unit-tested.
pub(crate) fn gemini_sanitize_schema(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .filter(|(k, _)| {
                    !matches!(k.as_str(), "additionalProperties" | "$schema" | "strict")
                })
                .map(|(k, val)| (k.clone(), gemini_sanitize_schema(val)))
                .collect(),
        ),
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(gemini_sanitize_schema).collect())
        }
        other => other.clone(),
    }
}

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
                _ if !m.tool_calls.is_empty() => {
                    // Synthesized assistant turn → model role with functionCall parts (T13).
                    let parts: Vec<serde_json::Value> = m
                        .tool_calls
                        .iter()
                        .map(|tc| {
                            serde_json::json!({
                                "functionCall": { "name": tc.name, "args": tc.arguments }
                            })
                        })
                        .collect();
                    contents.push(serde_json::json!({ "role": "model", "parts": parts }));
                }
                _ if !m.tool_results.is_empty() => {
                    // Synthesized tool-result turn → user role with functionResponse parts (T13).
                    let parts: Vec<serde_json::Value> = m
                        .tool_results
                        .iter()
                        .map(|tr| {
                            serde_json::json!({
                                "functionResponse": {
                                    "name": tr.name,
                                    "response": { "result": tr.content }
                                }
                            })
                        })
                        .collect();
                    contents.push(serde_json::json!({ "role": "user", "parts": parts }));
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
        if !req.tools.is_empty() {
            body["tools"] = serde_json::Value::Array(gemini_tools(req.tools));
        }
        // Reasoning capture: ask Gemini 2.x thinking models to return thought
        // summaries as `thought: true` parts (ignored by non-thinking models).
        // generationConfig carries reasoning (thought summaries) and/or
        // structured-output settings — build it up so the two don't clobber.
        let mut gen_config = serde_json::Map::new();
        if req.reasoning {
            gen_config.insert(
                "thinkingConfig".into(),
                serde_json::json!({ "includeThoughts": true }),
            );
        }
        if let Some(schema) = req.response_schema {
            gen_config.insert(
                "responseMimeType".into(),
                serde_json::Value::String("application/json".into()),
            );
            gen_config.insert("responseSchema".into(), gemini_sanitize_schema(schema));
        }
        if !gen_config.is_empty() {
            body["generationConfig"] = serde_json::Value::Object(gen_config);
        }

        // Developer trace: surface the exact (redacted) request before sending.
        if req.trace {
            let _ = channel.send(StreamDelta::api_trace(
                "request",
                req.round,
                redact_trace_body(&body),
            ));
        }

        let url = generate_url(req.base_url, req.model);
        let mut resp = send_with_retry(
            client
                .post(&url)
                .header("x-goog-api-key", req.api_key)
                .json(&body),
            cancel,
        )
        .await
        .context("gemini request failed")?;

        // Resilience: responseSchema 400s on models that don't support
        // structured output. Drop it and retry once unconstrained.
        if !resp.status().is_success() && req.response_schema.is_some() {
            if let Some(gc) = body
                .get_mut("generationConfig")
                .and_then(|g| g.as_object_mut())
            {
                gc.remove("responseSchema");
                gc.remove("responseMimeType");
            }
            resp = send_with_retry(
                client
                    .post(&url)
                    .header("x-goog-api-key", req.api_key)
                    .json(&body),
                cancel,
            )
            .await
            .context("gemini retry failed")?;
        }

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("gemini error {status}: {text}"));
        }

        let mut content = String::new();
        let mut usage = Usage::default();
        let mut tool_calls: Vec<ToolCall> = Vec::new();

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
                        // A `thought: true` part is the model's reasoning summary
                        // (thinking models, when capture is on) — route it to the
                        // reasoning panel rather than the answer text.
                        if part.get("thought").and_then(|b| b.as_bool()) == Some(true) {
                            channel
                                .send(StreamDelta::reasoning(t))
                                .map_err(|e| anyhow!("channel send failed: {e}"))?;
                        } else {
                            content.push_str(t);
                            channel
                                .send(StreamDelta::text(t))
                                .map_err(|e| anyhow!("channel send failed: {e}"))?;
                        }
                    } else if let Some(fc) = part.get("functionCall") {
                        // Gemini emits a complete functionCall part (not streamed
                        // fragments) and supplies no id — synthesize one (T13).
                        let name = fc
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let arguments = fc
                            .get("args")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!({}));
                        tool_calls.push(ToolCall {
                            id: format!("call_{}", tool_calls.len()),
                            name,
                            arguments,
                        });
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
            tool_calls,
            thinking_blocks: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{gemini_sanitize_schema, generate_url};
    use serde_json::json;

    #[test]
    fn generate_url_defaults_trims_and_overrides() {
        let official = "https://generativelanguage.googleapis.com/v1beta/models";
        assert_eq!(
            generate_url(None, "gemini-2.0-flash"),
            format!("{official}/gemini-2.0-flash:streamGenerateContent?alt=sse")
        );
        assert_eq!(
            generate_url(Some(""), "gemini-2.0-flash"),
            format!("{official}/gemini-2.0-flash:streamGenerateContent?alt=sse")
        );
        assert_eq!(
            generate_url(Some("https://proxy.test/"), "m"),
            "https://proxy.test/m:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn sanitize_strips_unsupported_keywords_recursively() {
        let schema = json!({
            "type": "object",
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#",
            "required": ["strategy", "steps"],
            "properties": {
                "strategy": { "type": "string", "enum": ["direct", "route"] },
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "strict": true,
                        "properties": { "id": { "type": "string" } }
                    }
                }
            }
        });
        let out = gemini_sanitize_schema(&schema);
        // Unsupported keywords are gone, at every depth.
        assert!(out.get("additionalProperties").is_none());
        assert!(out.get("$schema").is_none());
        assert!(out["properties"]["steps"]["items"]
            .get("additionalProperties")
            .is_none());
        assert!(out["properties"]["steps"]["items"]
            .get("strict")
            .is_none());
        // Supported structure is preserved.
        assert_eq!(out["type"], "object");
        assert_eq!(out["required"][0], "strategy");
        assert_eq!(out["properties"]["strategy"]["enum"][0], "direct");
        assert_eq!(
            out["properties"]["steps"]["items"]["properties"]["id"]["type"],
            "string"
        );
    }
}
