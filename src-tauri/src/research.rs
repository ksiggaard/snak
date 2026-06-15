//! Deep research mode (T55, idea #26).
//!
//! When the user enables deep research on a thread, the orchestrator model is
//! given one extra tool — `research__dispatch` — plus a system prompt nudging it
//! to decompose the question and dispatch **subagents**. Each subagent runs its
//! own bounded tool-loop (the same `run_agent_loop` the orchestrator uses) over a
//! *fresh, focused* context with the web tools available but **without** the
//! dispatch tool, so it cannot recurse (depth is bounded to 1). Subagents run
//! concurrently; their concise summaries are aggregated into the dispatch tool's
//! result and fed back to the orchestrator for its next round. A subagent's own
//! token-heavy search transcripts never enter the orchestrator's context — only
//! the summaries do — which is the whole point: keep the main thread clean.
//!
//! This module holds the **pure** pieces (the tool descriptor, the prompts, and
//! the request parsing / result formatting) so they are unit-testable without a
//! provider or transport. The orchestration itself (spawning subagents, which
//! recursively calls `run_agent_loop`) lives in `commands::chat` to avoid a
//! module cycle.

use serde_json::json;

use crate::providers::ToolDef;

/// The namespaced name of the subagent-dispatch tool. Namespaced like every MCP
/// tool (`<server>__<tool>`) so the chat loop's interception (which keys on the
/// name) and the no-such-server fallback both behave predictably.
pub const DISPATCH_TOOL_NAME: &str = "research__dispatch";

/// Hard cap on subtasks per `dispatch` call (also advertised in the schema).
pub const MAX_SUBTASKS: usize = 6;

/// Default number of subagents that run at once when the user hasn't configured
/// it (Settings → Advanced). Bounds simultaneous provider calls (rate limits /
/// cost spikes) while still parallelizing; extra subtasks queue.
pub const DEFAULT_SUBAGENT_CONCURRENCY: usize = 3;

/// Hard upper bound on the configured concurrency, so a setting can't fan out an
/// unbounded number of provider calls at once.
pub const MAX_SUBAGENT_CONCURRENCY: usize = 8;

/// Clamp a configured subagent concurrency to `[1, MAX_SUBAGENT_CONCURRENCY]`.
/// Pure / unit-tested.
pub fn clamp_concurrency(n: usize) -> usize {
    n.clamp(1, MAX_SUBAGENT_CONCURRENCY)
}

/// Tool-call rounds a single subagent may take before it must answer. Lower than
/// the orchestrator's cap — a subagent's job is one focused investigation.
pub const SUBAGENT_MAX_ROUNDS: usize = 4;

/// Prepended (after the tool prompt) to the orchestrator's history when deep
/// research is on. Teaches it to decompose and dispatch.
pub const RESEARCH_SYSTEM_PROMPT: &str = "Deep research mode is ON. You can call \
`research__dispatch` to launch research subagents that investigate subtasks in \
parallel. Each subagent has its OWN fresh context and the same web tools you do, \
works independently, and returns a SHORT, factual summary of what it found — its \
raw searches never enter this conversation, only its summary does. Use this to \
cover independent angles of a question at once (pass several subtasks in one \
call), and call it again on a later turn once a first batch tells you what to \
investigate next. Prefer dispatching subagents over searching the web yourself \
for anything that needs more than a single quick lookup. When the summaries come \
back, synthesize them into one clear, well-organized answer and cite the sources \
the subagents reported. Subagents CANNOT dispatch further subagents.";

/// The system turn each subagent runs under: a focused, terse-output researcher.
pub const SUBAGENT_SYSTEM_PROMPT: &str = "You are a research subagent. You have \
been given ONE focused task. Use your web tools (`web__search_web` then \
`web__fetch_url`) to investigate it, then reply with a SHORT, factual summary — \
just the findings relevant to the task, with the key facts and the source URLs \
you used. Do not add preamble, restate the task, or ask questions. Be concise \
and to the point; your summary will be read by another model that is combining \
many such summaries.";

/// The `research__dispatch` tool descriptor exposed to the orchestrator.
pub fn dispatch_tool_def() -> ToolDef {
    ToolDef {
        name: DISPATCH_TOOL_NAME.to_string(),
        description: "Dispatch one or more research subagents to investigate \
subtasks in parallel. Each subagent has its own fresh context and web tools, \
works independently, and returns a concise summary of its findings. Use this to \
gather information on independent angles at once; call it again on a later turn \
once you know what to investigate next. Each subagent CANNOT dispatch further \
subagents."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "subtasks": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_SUBTASKS,
                    "description": "The research subtasks to investigate, one per subagent.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "task": {
                                "type": "string",
                                "description": "A self-contained research question for one subagent."
                            }
                        },
                        "required": ["task"]
                    }
                }
            },
            "required": ["subtasks"]
        }),
    }
}

/// Parse the `subtasks` array out of a `research__dispatch` call's arguments into
/// a clean list of task strings. Returns `Err(message)` for a malformed or
/// out-of-bounds request; the caller feeds that string back to the model as the
/// tool result (so a bad call self-corrects rather than aborting the turn). Pure.
pub fn parse_subtasks(args: &serde_json::Value) -> Result<Vec<String>, String> {
    let arr = args
        .get("subtasks")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            "dispatch error: `subtasks` must be an array of {task} objects".to_string()
        })?;

    let mut tasks = Vec::with_capacity(arr.len());
    for item in arr {
        let task = item
            .get("task")
            .and_then(|t| t.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        match task {
            Some(t) => tasks.push(t.to_string()),
            None => {
                return Err(
                    "dispatch error: every subtask needs a non-empty `task` string".to_string(),
                )
            }
        }
    }

    if tasks.is_empty() {
        return Err("dispatch error: provide at least one subtask".to_string());
    }
    if tasks.len() > MAX_SUBTASKS {
        return Err(format!(
            "dispatch error: at most {MAX_SUBTASKS} subtasks per call (got {})",
            tasks.len()
        ));
    }
    Ok(tasks)
}

/// Format the subagents' results into the single text block fed back to the
/// orchestrator as the `research__dispatch` tool result. Each entry is the
/// subtask paired with either its summary (`Ok`) or a failure reason (`Err`).
/// Compact on purpose — this is what re-enters the orchestrator's context. Pure.
pub fn aggregate_summaries(results: &[(String, Result<String, String>)]) -> String {
    let mut out = String::new();
    for (i, (task, result)) in results.iter().enumerate() {
        if i > 0 {
            out.push_str("\n\n");
        }
        out.push_str(&format!("Subagent {} (task: \"{}\"):\n", i + 1, task));
        match result {
            Ok(summary) => out.push_str(summary.trim()),
            Err(reason) => out.push_str(&format!("FAILED: {reason}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dispatch_tool_def_shape() {
        let def = dispatch_tool_def();
        assert_eq!(def.name, DISPATCH_TOOL_NAME);
        assert!(!def.description.is_empty());
        // Required top-level `subtasks` array with a bounded item count.
        let schema = &def.input_schema;
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["required"][0], "subtasks");
        assert_eq!(schema["properties"]["subtasks"]["type"], "array");
        assert_eq!(
            schema["properties"]["subtasks"]["maxItems"],
            MAX_SUBTASKS as u64
        );
    }

    #[test]
    fn parse_subtasks_happy_path_trims() {
        let args = json!({ "subtasks": [{ "task": "  a  " }, { "task": "b" }] });
        assert_eq!(parse_subtasks(&args).unwrap(), vec!["a", "b"]);
    }

    #[test]
    fn parse_subtasks_rejects_missing_array() {
        assert!(parse_subtasks(&json!({})).is_err());
        assert!(parse_subtasks(&json!({ "subtasks": "x" })).is_err());
    }

    #[test]
    fn parse_subtasks_rejects_empty_and_blank() {
        assert!(parse_subtasks(&json!({ "subtasks": [] })).is_err());
        assert!(parse_subtasks(&json!({ "subtasks": [{ "task": "   " }] })).is_err());
        assert!(parse_subtasks(&json!({ "subtasks": [{ "nope": "x" }] })).is_err());
    }

    #[test]
    fn parse_subtasks_rejects_too_many() {
        let many: Vec<_> = (0..MAX_SUBTASKS + 1)
            .map(|i| json!({ "task": i.to_string() }))
            .collect();
        assert!(parse_subtasks(&json!({ "subtasks": many })).is_err());
    }

    #[test]
    fn clamp_concurrency_bounds() {
        assert_eq!(clamp_concurrency(0), 1);
        assert_eq!(clamp_concurrency(1), 1);
        assert_eq!(clamp_concurrency(3), 3);
        assert_eq!(clamp_concurrency(999), MAX_SUBAGENT_CONCURRENCY);
    }

    #[test]
    fn aggregate_summaries_formats_ok_and_failed() {
        let results = vec![
            ("find X".to_string(), Ok("X is 42.".to_string())),
            ("find Y".to_string(), Err("timed out".to_string())),
        ];
        let agg = aggregate_summaries(&results);
        assert!(agg.contains("Subagent 1 (task: \"find X\"):"));
        assert!(agg.contains("X is 42."));
        assert!(agg.contains("Subagent 2 (task: \"find Y\"):"));
        assert!(agg.contains("FAILED: timed out"));
    }
}
