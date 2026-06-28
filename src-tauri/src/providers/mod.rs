//! Provider abstraction: a normalized chat request is dispatched to one of the
//! supported LLM providers, each implemented over raw HTTP (`reqwest`) with SSE
//! streaming. The Anthropic provider uses raw HTTP because there is no official
//! Rust SDK.

pub mod anthropic;
pub mod gemini;
pub mod mistral;
pub mod ollama;
pub mod openai;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

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

/// A single conversation turn. Most come from the frontend (`role`/`content`/
/// `images`); the tool-call round-trip loop (T13) also synthesizes two extra
/// turn shapes *in Rust* and appends them between provider rounds:
///   - an assistant turn carrying `tool_calls` (what the model asked to run), and
///   - a tool turn carrying `tool_results` (what the MCP servers returned).
///
/// Both extra fields default to empty, so frontend deserialization is unchanged
/// and an ordinary turn serializes/maps exactly as before.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessage {
    /// "user" | "assistant" | "system" | "tool"
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub images: Vec<ImagePart>,
    /// Tool calls on an assistant turn (Rust-synthesized; never from frontend).
    #[serde(default, skip_deserializing)]
    pub tool_calls: Vec<ToolCall>,
    /// Tool results on a tool turn (Rust-synthesized; never from frontend).
    #[serde(default, skip_deserializing)]
    pub tool_results: Vec<ToolResult>,
    /// Raw Anthropic "thinking" blocks captured on the assistant turn that asked
    /// for the tools (Rust-synthesized; never from frontend). Echoed back to
    /// Anthropic verbatim before the `tool_use` block — required when extended
    /// thinking is combined with tool use. Empty for every other provider.
    #[serde(default, skip_deserializing)]
    pub thinking_blocks: Vec<serde_json::Value>,
}

/// The result of executing one tool call, fed back to the model next round.
#[derive(Debug, Clone)]
pub struct ToolResult {
    /// The originating tool-call id (correlates to `ToolCall::id`).
    pub tool_call_id: String,
    /// The tool name (some providers want it echoed on the result).
    pub name: String,
    pub content: String,
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

impl Usage {
    /// Fold another `Usage` into this one (sum each field). Used by deep research
    /// (T55) to attribute subagents' token spend to the orchestrator's response.
    pub(crate) fn add(&mut self, other: &Usage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_creation_tokens += other.cache_creation_tokens;
        self.cache_read_tokens += other.cache_read_tokens;
    }
}

/// A tool the model may call, as exposed to a provider's tool-use API. `name` is
/// already namespaced (`<server-id>__<tool>`) by the MCP layer; `input_schema` is
/// a JSON Schema object. (T13)
#[derive(Debug, Clone)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// A tool call the model emitted during streaming. `id` is the provider's
/// tool-use id (used to correlate the result on the next round; synthesized for
/// providers that don't supply one, e.g. Gemini). `arguments` is the parsed JSON
/// input object. (T13)
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// Normalized completion result returned once a provider stream ends. When
/// `tool_calls` is non-empty the model wants tools run before it can finish; the
/// chat loop executes them and calls the provider again (T13). An empty
/// `tool_calls` (the default for a tool-less request) means normal completion —
/// the no-tools path is byte-identical to before.
#[derive(Debug, Default, Serialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
    /// Per-response token usage parsed from the stream's usage event(s).
    pub usage: Usage,
    /// Tool calls the model emitted this round (skipped in serialization — the
    /// frontend never sees them; the loop resolves them server-side).
    #[serde(skip)]
    pub tool_calls: Vec<ToolCall>,
    /// Raw provider "thinking" content blocks captured this round (Anthropic
    /// only, when reasoning is on). Echoed back verbatim — signature included —
    /// in the next round's assistant turn, which Anthropic *requires* when
    /// extended thinking is combined with tool use. Skipped in serialization
    /// (loop-internal); empty for every other provider and for tool-less rounds.
    #[serde(skip)]
    pub thinking_blocks: Vec<serde_json::Value>,
}

/// One streamed event pushed to the frontend over a Tauri channel: either a
/// text chunk or a notice that the model invoked a tool this round. Tool calls
/// are sent as their own structured event (not text) so the UI can render a
/// distinct, non-spoofable indicator the model itself can't produce.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamDelta {
    /// Text chunk; empty (and omitted on the wire) for a tool-call event.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub text: String,
    /// A chunk of the model's reasoning / extended-thinking (when reasoning
    /// capture is on). Carried as its own event so the UI renders it in a
    /// distinct, collapsible panel rather than as answer text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<ReasoningDelta>,
    /// A raw API-trace event: the exact request body (redacted) before a round,
    /// or a compact response summary after it. Emitted only when trace capture
    /// is on, for the developer/inspect panel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_trace: Option<ApiTraceDelta>,
    /// Set when the model called a tool this round (the "tool started" event).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<ToolCallDelta>,
    /// A chunk of a running tool's live output (e.g. a stdout line from a
    /// system-diagnostic command), correlated to its call by `id`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<ToolOutputDelta>,
    /// Marks a tool call as finished (so the UI can collapse its live panel).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_done: Option<ToolDoneDelta>,
    /// Set when a tool call needs explicit user approval before it runs. The
    /// frontend shows an approve/deny card and replies via `approve_tool_call`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_request: Option<ApprovalRequest>,
    /// Images a tool fetched (e.g. `web__search_images` / `web__fetch_images`),
    /// streamed as base64 bytes so the frontend can render + persist them as
    /// message image attachments. Carried out-of-band (not in the model-facing
    /// tool result text) so base64 never pollutes the context window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_images: Option<ToolImagesDelta>,
    /// Web sources a tool consulted (`web__search_web` hits, `web__fetch_url`
    /// page), streamed so the UI can show what informed the answer with clickable
    /// links. Out-of-band from the model-facing result text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_sources: Option<ToolSourcesDelta>,
    /// Lifecycle of a research subagent (deep research mode, T55): dispatched →
    /// running → done/failed, carrying the subtask and (on completion) the
    /// concise summary. Absent for ordinary streams, so the wire is unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent: Option<SubagentDelta>,
}

impl StreamDelta {
    /// A plain text chunk (the common case all providers emit while streaming).
    pub(crate) fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Default::default()
        }
    }

    /// A chunk of the model's reasoning / extended thinking.
    pub(crate) fn reasoning(text: impl Into<String>) -> Self {
        Self {
            reasoning: Some(ReasoningDelta { text: text.into() }),
            ..Default::default()
        }
    }

    /// An API-trace event: `phase` is "request" (the redacted request body) or
    /// "response" (a compact summary), `round` is the 0-based agent-loop round.
    pub(crate) fn api_trace(phase: &str, round: u32, data: serde_json::Value) -> Self {
        Self {
            api_trace: Some(ApiTraceDelta {
                phase: phase.to_string(),
                round,
                data,
            }),
            ..Default::default()
        }
    }

    /// A tool-invocation notice (carries no text). `command` is the resolved
    /// command line / target for tools that have one (system diagnostics), shown
    /// in the live activity panel; `None` for tools without one.
    pub(crate) fn tool(call: &ToolCall, command: Option<String>) -> Self {
        Self {
            tool_call: Some(ToolCallDelta::new(call, command)),
            ..Default::default()
        }
    }

    /// A chunk of a running tool's live output, keyed to its call `id`.
    pub(crate) fn tool_output(id: &str, chunk: impl Into<String>) -> Self {
        Self {
            tool_output: Some(ToolOutputDelta {
                id: id.to_string(),
                chunk: chunk.into(),
            }),
            ..Default::default()
        }
    }

    /// Images a tool fetched, keyed to its call `id`. Streamed once per tool call
    /// (or in batches); the frontend renders + persists them as image attachments.
    pub(crate) fn tool_images(id: &str, images: Vec<ToolImage>) -> Self {
        Self {
            tool_images: Some(ToolImagesDelta {
                id: id.to_string(),
                images,
            }),
            ..Default::default()
        }
    }

    /// Web sources a tool consulted, keyed to its call `id`. Streamed once per
    /// tool call; the frontend renders them as clickable links and persists them
    /// on the tool-call record.
    pub(crate) fn tool_sources(id: &str, sources: Vec<ToolSource>) -> Self {
        Self {
            tool_sources: Some(ToolSourcesDelta {
                id: id.to_string(),
                sources,
            }),
            ..Default::default()
        }
    }

    /// A research-subagent lifecycle event (deep research, T55): `phase` is one of
    /// "dispatched" | "running" | "done" | "failed". `task` rides the dispatched
    /// event; `summary` rides the done event.
    pub(crate) fn subagent(
        id: &str,
        phase: &str,
        task: Option<String>,
        summary: Option<String>,
    ) -> Self {
        Self {
            subagent: Some(SubagentDelta {
                id: id.to_string(),
                phase: phase.to_string(),
                task,
                summary,
            }),
            ..Default::default()
        }
    }

    /// A "tool finished" marker, keyed to its call `id`. `ok` is false when the
    /// tool errored (the UI tints the collapsed panel accordingly).
    pub(crate) fn tool_done(id: &str, ok: bool) -> Self {
        Self {
            tool_done: Some(ToolDoneDelta {
                id: id.to_string(),
                ok,
            }),
            ..Default::default()
        }
    }

    /// A request for the user to approve a gated tool call before it runs.
    pub(crate) fn approval(
        call: &ToolCall,
        summary: String,
        detail: String,
        explanation: String,
        warning: Option<String>,
    ) -> Self {
        Self {
            approval_request: Some(ApprovalRequest {
                id: call.id.clone(),
                tool_name: call.name.clone(),
                summary,
                detail,
                explanation,
                warning,
            }),
            ..Default::default()
        }
    }
}

/// A pending tool call awaiting user approval, surfaced to the UI's approval
/// card. `id` correlates the eventual `approve_tool_call(id, approved)` reply.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub tool_name: String,
    /// Short action label, e.g. "Read file".
    pub summary: String,
    /// The exact target — a path or the resolved command line.
    pub detail: String,
    /// Optional plain-English description of what the call does (the model's
    /// `explanation` for `run_command`; empty for the read-only tools).
    pub explanation: String,
    /// A risk warning when the call is not read-only (e.g. a `run_command` that
    /// writes or deletes); absent for the read-only tools.
    pub warning: Option<String>,
}

/// A compact, display-oriented view of a tool call, streamed to the UI and
/// persisted alongside the assistant message. `url` is populated for the
/// built-in `web__fetch_url` tool so the UI can show what page was fetched.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallDelta {
    /// Call id, correlating later `tool_output` / `tool_done` events to this chip.
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Resolved command line / target, for tools that run one (system
    /// diagnostics). Shown as the `$ …` line of the live activity panel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// The parsed tool input the model supplied — surfaced (and persisted) so
    /// the UI's expanded tool panel can show *exactly* what arguments the model
    /// passed. Omitted on the wire when empty (`{}` / null).
    #[serde(skip_serializing_if = "is_empty_args")]
    pub arguments: serde_json::Value,
}

/// True for a tool-input value with nothing worth showing (null, or an empty
/// object) — lets `arguments` stay off the wire for argument-less calls.
fn is_empty_args(v: &serde_json::Value) -> bool {
    v.is_null() || v.as_object().is_some_and(|o| o.is_empty())
}

impl ToolCallDelta {
    fn new(call: &ToolCall, command: Option<String>) -> Self {
        let url = call
            .arguments
            .get("url")
            .and_then(|u| u.as_str())
            .map(String::from);
        Self {
            id: call.id.clone(),
            name: call.name.clone(),
            url,
            command,
            arguments: call.arguments.clone(),
        }
    }
}

/// A chunk of the model's reasoning / extended-thinking output, streamed to the
/// UI's collapsible reasoning panel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningDelta {
    pub text: String,
}

/// A raw API-trace event for the developer/inspect panel: the redacted request
/// body before a round, or a compact response summary after it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiTraceDelta {
    /// "request" | "response"
    pub phase: String,
    /// 0-based agent-loop round this trace belongs to.
    pub round: u32,
    /// The request body (redacted) or the response summary object.
    pub data: serde_json::Value,
}

/// A chunk of a running tool's live output, streamed to the UI as it is
/// produced and correlated to its call by `id`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutputDelta {
    pub id: String,
    pub chunk: String,
}

/// Marks a tool call as finished so the UI collapses its live panel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDoneDelta {
    pub id: String,
    pub ok: bool,
}

/// One image a tool fetched, streamed to the UI as base64 bytes. Rendered as a
/// thumbnail and persisted as a message image attachment; `source_url` (the page
/// the image came from) is kept so the lightbox can link back to it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolImage {
    pub media_type: String,
    /// Base64-encoded image bytes (no `data:` prefix).
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// A batch of images produced by a single tool call, keyed to its `id`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolImagesDelta {
    pub id: String,
    pub images: Vec<ToolImage>,
}

/// One web source a tool consulted (a search hit or a fetched page), streamed to
/// the UI so the user can see what informed the answer and open the link. Carried
/// out-of-band from the model-facing result text, like images.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSource {
    /// The page URL — rendered as a clickable link in the tool-activity panel.
    pub url: String,
    /// Result title, when known (search hits have one; a bare fetch does not).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// A short excerpt: the search snippet, or the lead of a fetched page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// The web sources produced by a single tool call, keyed to its `id`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSourcesDelta {
    pub id: String,
    pub sources: Vec<ToolSource>,
}

/// A research subagent's lifecycle event (deep research mode, T55). `id` is
/// stable across the subagent's dispatched → running → done/failed events so the
/// UI can update one card. `task` is the subtask string (sent on dispatch);
/// `summary` is the subagent's concise result (sent on done).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentDelta {
    pub id: String,
    /// "dispatched" | "running" | "done" | "failed"
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// Everything a provider needs for one completion. `tools` is empty for an
/// ordinary chat request — a provider sends *no* `tools` field when the slice is
/// empty, so the wire request is identical to before (T13 no-tools invariant).
pub struct CompletionRequest<'a> {
    pub model: &'a str,
    pub api_key: &'a str,
    pub messages: &'a [ChatMessage],
    pub tools: &'a [ToolDef],
    /// Base URL for a user-added OpenAI-compatible provider (`{base}/chat/completions`).
    /// `None` for the five built-in providers, which use their own hardcoded endpoints.
    pub base_url: Option<&'a str>,
    /// Capture the model's reasoning/thinking this request (global setting): the
    /// provider adds the relevant request param and emits `reasoning` deltas.
    /// `false` keeps the request byte-identical to before.
    pub reasoning: bool,
    /// Emit an API-trace event (redacted request body) before sending, for the
    /// developer/inspect panel. `false` emits nothing.
    pub trace: bool,
    /// 0-based agent-loop round, stamped on any trace event so the UI groups
    /// request/response pairs by round.
    pub round: u32,
}

/// Maximum length of a string left intact in an API trace; anything longer is
/// replaced with a short marker. Keeps giant base64 image data and 100k-char
/// document text out of the trace while preserving normal prompts/params.
const TRACE_MAX_STRING: usize = 2_000;

/// Deep-clone a request body for the API trace, truncating over-long strings
/// (base64 image data, extracted document text) to a marker so the trace stays
/// small and readable. Pure / unit-tested.
pub(crate) fn redact_trace_body(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::String(s) if s.len() > TRACE_MAX_STRING => {
            serde_json::Value::String(format!("[… {} chars elided …]", s.len()))
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(redact_trace_body).collect())
        }
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .map(|(k, val)| (k.clone(), redact_trace_body(val)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Returns true if the user requested cancellation of the in-flight stream.
/// Threaded into each provider's SSE closure so it can early-exit (returning the
/// partially-accumulated text) the same way `message_stop` / `[DONE]` does.
pub(crate) fn is_cancelled(cancel: &AtomicBool) -> bool {
    cancel.load(Ordering::Relaxed)
}

/// Max attempts (1 initial + retries) for a request that fails transiently.
const MAX_REQUEST_ATTEMPTS: u32 = 4;

/// HTTP statuses worth retrying: rate limiting (429) and transient upstream
/// errors (502/503/504). 500 is left alone — it's usually a real server fault,
/// not something a retry fixes. Pure / unit-tested.
pub(crate) fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 429 | 502 | 503 | 504)
}

/// Exponential backoff for attempt `n` (1-based): 0.5s, 1s, 2s, 4s… capped at
/// 8s. Pure / unit-tested.
pub(crate) fn backoff_delay(attempt: u32) -> Duration {
    let shift = (attempt.saturating_sub(1)).min(6);
    Duration::from_millis((500u64 << shift).min(8_000))
}

/// Parse a `Retry-After` header in delta-seconds form (the form the LLM APIs
/// send) into a duration, capped so a hostile/huge value can't stall us. Pure.
fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|secs| Duration::from_secs(secs.min(30)))
}

/// Sleep for `delay`, polling `cancel` so a Stop mid-backoff aborts promptly.
/// Returns false if cancellation was observed (the caller should stop retrying).
async fn sleep_cancellable(delay: Duration, cancel: &AtomicBool) -> bool {
    let step = Duration::from_millis(100);
    let mut elapsed = Duration::ZERO;
    while elapsed < delay {
        if is_cancelled(cancel) {
            return false;
        }
        let chunk = step.min(delay - elapsed);
        tokio::time::sleep(chunk).await;
        elapsed += chunk;
    }
    !is_cancelled(cancel)
}

/// Send a request, retrying on transient failures — rate limits (429) and
/// transient 5xx, plus connect/timeout errors — with exponential backoff that
/// honors a `Retry-After` header. The body must be cloneable (JSON bodies are)
/// so the request can be re-issued; a non-cloneable (streamed) body is sent once.
/// Returns the final response *as-is* — including a non-success one once retries
/// are exhausted — so each provider's existing status/body error handling is
/// unchanged. Honors `cancel` during the backoff wait.
///
/// This matters for deep research (T55): an orchestrator firing several
/// concurrent subagents at one provider routinely trips a thin tier's per-minute
/// 429, which previously failed the subagent outright.
pub(crate) async fn send_with_retry(
    builder: reqwest::RequestBuilder,
    cancel: &AtomicBool,
) -> reqwest::Result<reqwest::Response> {
    let mut attempt: u32 = 0;
    loop {
        attempt += 1;
        // Clone for this attempt so the builder survives a retry; a body that
        // can't be cloned (e.g. a stream) is sent once and returned.
        let Some(req) = builder.try_clone() else {
            return builder.send().await;
        };
        match req.send().await {
            Ok(resp) => {
                if attempt >= MAX_REQUEST_ATTEMPTS || !is_retryable_status(resp.status()) {
                    return Ok(resp);
                }
                let delay = retry_after(resp.headers()).unwrap_or_else(|| backoff_delay(attempt));
                // Cancelled mid-wait: hand back this response so the caller
                // surfaces the (retryable) status rather than spinning.
                if !sleep_cancellable(delay, cancel).await {
                    return Ok(resp);
                }
            }
            Err(e) => {
                let transient = e.is_connect() || e.is_timeout();
                if attempt >= MAX_REQUEST_ATTEMPTS || !transient {
                    return Err(e);
                }
                if !sleep_cancellable(backoff_delay(attempt), cancel).await {
                    return Err(e);
                }
            }
        }
    }
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
        "ollama" => ollama::Ollama.stream(client, req, channel, cancel).await,
        // User-added OpenAI-compatible provider: any unknown id streams through the
        // shared OpenAI engine against the base URL carried on the request.
        other => match req.base_url {
            Some(base) => openai::chat_completions_stream(client, base, req, channel, cancel).await,
            None => anyhow::bail!("unknown provider: {other}"),
        },
    }
}

/// True for providers that need no API key (local daemons). `chat_stream` skips
/// the keychain fetch for these. Pure / unit-tested.
pub fn is_keyless(provider: &str) -> bool {
    provider == "ollama"
}

/// Map `ToolDef`s to the Anthropic `tools` array shape
/// (`{name, description, input_schema}`). Empty in → empty out (caller omits the
/// field entirely when empty). Pure / unit-tested.
pub(crate) fn anthropic_tools(tools: &[ToolDef]) -> Vec<serde_json::Value> {
    tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema,
            })
        })
        .collect()
}

/// Map `ToolDef`s to the OpenAI/Mistral `tools` array shape
/// (`{type:"function", function:{name, description, parameters}}`).
/// Pure / unit-tested.
pub(crate) fn openai_tools(tools: &[ToolDef]) -> Vec<serde_json::Value> {
    tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                }
            })
        })
        .collect()
}

/// Map `ToolDef`s to the Gemini `tools` shape
/// (`[{functionDeclarations:[{name, description, parameters}]}]`).
/// Pure / unit-tested.
pub(crate) fn gemini_tools(tools: &[ToolDef]) -> Vec<serde_json::Value> {
    let decls: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "description": t.description,
                "parameters": t.input_schema,
            })
        })
        .collect();
    vec![serde_json::json!({ "functionDeclarations": decls })]
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
    for_each_line(resp, |line| {
        if let Some(data) = line.strip_prefix("data:") {
            on_data(data.trim())
        } else {
            Ok(true)
        }
    })
    .await
}

/// Read a streamed response line by line, invoking `on_line` with each
/// non-empty trimmed line (UTF-8 safe across chunk boundaries). Used for
/// newline-delimited JSON streams (Ollama's native `/api/chat`), where each
/// line is a complete JSON object rather than an SSE `data:` frame. The callback
/// may return `Ok(false)` to stop early.
pub(crate) async fn for_each_line<F>(resp: reqwest::Response, mut on_line: F) -> anyhow::Result<()>
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
            if !line.is_empty() && !on_line(line)? {
                return Ok(());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ollama_is_keyless() {
        assert!(is_keyless("ollama"));
        for keyed in ["anthropic", "openai", "mistral", "gemini", "nonsense"] {
            assert!(!is_keyless(keyed), "{keyed} should require a key");
        }
    }

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

    fn sample_tool() -> ToolDef {
        ToolDef {
            name: "web__fetch_url".to_string(),
            description: "Fetch a URL".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"]
            }),
        }
    }

    #[test]
    fn anthropic_tool_schema_shape() {
        let out = anthropic_tools(&[sample_tool()]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["name"], "web__fetch_url");
        assert_eq!(out[0]["description"], "Fetch a URL");
        assert!(out[0]["input_schema"]["properties"]["url"].is_object());
        assert!(anthropic_tools(&[]).is_empty());
    }

    #[test]
    fn openai_tool_schema_shape() {
        let out = openai_tools(&[sample_tool()]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["type"], "function");
        assert_eq!(out[0]["function"]["name"], "web__fetch_url");
        assert!(out[0]["function"]["parameters"]["properties"]["url"].is_object());
    }

    #[test]
    fn gemini_tool_schema_shape() {
        let out = gemini_tools(&[sample_tool()]);
        assert_eq!(out.len(), 1);
        let decls = out[0]["functionDeclarations"].as_array().unwrap();
        assert_eq!(decls.len(), 1);
        assert_eq!(decls[0]["name"], "web__fetch_url");
        assert!(decls[0]["parameters"]["properties"]["url"].is_object());
    }

    #[test]
    fn gemini_usage_without_cache() {
        let obj = serde_json::json!({"promptTokenCount": 7, "candidatesTokenCount": 8});
        let u = parse_gemini_usage(&obj);
        assert_eq!(u.input_tokens, 7);
        assert_eq!(u.output_tokens, 8);
        assert_eq!(u.cache_read_tokens, 0);
    }

    fn fetch_call() -> ToolCall {
        ToolCall {
            id: "call_1".into(),
            name: "web__fetch_url".into(),
            arguments: serde_json::json!({ "url": "https://example.com" }),
        }
    }

    #[test]
    fn tool_call_delta_extracts_url() {
        let d = ToolCallDelta::new(&fetch_call(), None);
        assert_eq!(d.name, "web__fetch_url");
        assert_eq!(d.url.as_deref(), Some("https://example.com"));
    }

    #[test]
    fn stream_delta_text_serializes_without_tool_call() {
        let v = serde_json::to_value(StreamDelta::text("hi")).unwrap();
        assert_eq!(v["text"], "hi");
        assert!(v.get("toolCall").is_none());
    }

    #[test]
    fn stream_delta_tool_serializes_camelcase_without_text() {
        let v = serde_json::to_value(StreamDelta::tool(&fetch_call(), None)).unwrap();
        // No `text` key (skipped when empty); tool call carried under camelCase key.
        assert!(v.get("text").is_none());
        assert_eq!(v["toolCall"]["name"], "web__fetch_url");
        assert_eq!(v["toolCall"]["url"], "https://example.com");
    }

    #[test]
    fn retryable_statuses() {
        use reqwest::StatusCode;
        assert!(is_retryable_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(StatusCode::BAD_GATEWAY));
        assert!(is_retryable_status(StatusCode::SERVICE_UNAVAILABLE));
        assert!(is_retryable_status(StatusCode::GATEWAY_TIMEOUT));
        // Not retried: success, auth, generic 500.
        assert!(!is_retryable_status(StatusCode::OK));
        assert!(!is_retryable_status(StatusCode::UNAUTHORIZED));
        assert!(!is_retryable_status(StatusCode::INTERNAL_SERVER_ERROR));
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff_delay(1), Duration::from_millis(500));
        assert_eq!(backoff_delay(2), Duration::from_millis(1000));
        assert_eq!(backoff_delay(3), Duration::from_millis(2000));
        // Capped at 8s no matter how high the attempt.
        assert_eq!(backoff_delay(50), Duration::from_millis(8000));
    }

    #[test]
    fn stream_delta_subagent_serializes_only_present_fields() {
        // A dispatched event carries `task` but omits `summary`.
        let v = serde_json::to_value(StreamDelta::subagent(
            "s-0",
            "dispatched",
            Some("find X".into()),
            None,
        ))
        .unwrap();
        assert!(v.get("text").is_none());
        assert_eq!(v["subagent"]["id"], "s-0");
        assert_eq!(v["subagent"]["phase"], "dispatched");
        assert_eq!(v["subagent"]["task"], "find X");
        assert!(v["subagent"].get("summary").is_none());
        // A non-subagent delta omits the `subagent` key entirely (wire unchanged).
        let plain = serde_json::to_value(StreamDelta::text("hi")).unwrap();
        assert!(plain.get("subagent").is_none());
    }

    #[test]
    fn reasoning_delta_serializes_camelcase_and_omits_others() {
        let v = serde_json::to_value(StreamDelta::reasoning("step 1")).unwrap();
        assert_eq!(v["reasoning"]["text"], "step 1");
        assert!(v.get("text").is_none());
        assert!(v.get("apiTrace").is_none());
    }

    #[test]
    fn api_trace_delta_carries_phase_round_and_data() {
        let v = serde_json::to_value(StreamDelta::api_trace(
            "request",
            2,
            serde_json::json!({ "model": "x" }),
        ))
        .unwrap();
        assert_eq!(v["apiTrace"]["phase"], "request");
        assert_eq!(v["apiTrace"]["round"], 2);
        assert_eq!(v["apiTrace"]["data"]["model"], "x");
    }

    #[test]
    fn redact_trace_body_elides_long_strings_only() {
        let big = "A".repeat(TRACE_MAX_STRING + 1);
        let body = serde_json::json!({
            "model": "claude",
            "messages": [{ "role": "user", "content": big }],
            "short": "kept",
        });
        let red = redact_trace_body(&body);
        assert_eq!(red["model"], "claude");
        assert_eq!(red["short"], "kept");
        let elided = red["messages"][0]["content"].as_str().unwrap();
        assert!(elided.starts_with("[… "), "got: {elided}");
        assert!(elided.contains("chars elided"));
    }

    #[test]
    fn tool_call_delta_includes_arguments_but_omits_empty() {
        let call = ToolCall {
            id: "c1".into(),
            name: "web__fetch_url".into(),
            arguments: serde_json::json!({ "url": "https://x.com" }),
        };
        let v = serde_json::to_value(StreamDelta::tool(&call, None)).unwrap();
        assert_eq!(v["toolCall"]["arguments"]["url"], "https://x.com");

        // An argument-less call keeps `arguments` off the wire.
        let bare = ToolCall {
            id: "c2".into(),
            name: "noop".into(),
            arguments: serde_json::json!({}),
        };
        let v = serde_json::to_value(StreamDelta::tool(&bare, None)).unwrap();
        assert!(v["toolCall"].get("arguments").is_none());
    }
}
