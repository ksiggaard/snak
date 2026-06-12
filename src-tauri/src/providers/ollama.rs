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

use std::sync::atomic::AtomicBool;

use anyhow::{anyhow, Context};
use tauri::ipc::Channel;

use super::{openai, u64_field, ChatResponse, CompletionRequest, Provider, StreamDelta};

/// Where the local Ollama daemon listens by default.
pub(crate) const BASE_URL: &str = "http://localhost:11434";

/// Ollama ignores the Authorization header entirely; the shared OpenAI driver
/// always sends a bearer token, so this placeholder goes on the wire.
const SYNTHETIC_API_KEY: &str = "ollama";

pub struct Ollama;

impl Provider for Ollama {
    async fn stream(
        &self,
        client: &reqwest::Client,
        req: &CompletionRequest<'_>,
        channel: &Channel<StreamDelta>,
        cancel: &AtomicBool,
    ) -> anyhow::Result<ChatResponse> {
        openai::chat_completions_stream(
            client,
            &format!("{BASE_URL}/v1"),
            SYNTHETIC_API_KEY,
            req.model,
            req.messages,
            req.tools,
            channel,
            cancel,
        )
        .await
        .map_err(friendly_connect_error)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

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
