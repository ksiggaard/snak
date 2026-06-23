//! Built-in, in-process **skill** tool server (`skill__*`).
//!
//! This is the *action layer* of the Agent Skills feature. Only the skill index
//! (name + description) sits in the system prompt; this server lets the model
//! pull a skill's full instructions, read its bundled files, and keep scratch
//! state — all on demand, so context isn't polluted with instructions the model
//! isn't using.
//!
//! Tools:
//! - `load_skill(name)` — return a skill's full markdown body (progressive
//!   disclosure: the model calls this once it decides a skill is relevant).
//! - `read_skill_file(skill, path)` — read a file bundled inside a skill folder.
//! - `list_workspace` / `read_workspace_file(path)` / `write_workspace_file(path,
//!   content)` — a per-thread scratch dir the model can read and write.
//!
//! ## Security
//! Reads are confined to the named skill's own folder; workspace I/O is confined
//! to `…/skill-workspace/<thread_id>/`. Every relative path is component-checked
//! (no `..`, no absolute/root components) and, when the target exists, verified to
//! canonicalize **within** its root. snak never *executes* anything here — these
//! tools move text/bytes only; commands still go through the `/terminal` gate.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context};
use serde_json::{json, Value};

use super::ToolDef;
use crate::skills;

/// The id used to namespace this server's tools (`skill__load_skill`, …).
pub const SERVER_ID: &str = "skill";

/// Cap on any single read handed back to the model (context-window safety).
const MAX_TEXT_LEN: usize = 20_000;
/// Bytes read off disk before truncation (covers `MAX_TEXT_LEN` chars in UTF-8).
const MAX_READ_BYTES: u64 = 256 * 1024;
/// Cap on a single workspace write.
const MAX_WRITE_BYTES: usize = 256 * 1024;
/// Cap on `list_workspace` entries.
const MAX_WS_ENTRIES: usize = 1000;

/// Resolved skill paths threaded from `chat_stream` (which holds the `AppHandle`)
/// down to the tool dispatch. `Default` (empty paths) degrades gracefully — the
/// tools just report "no skill / not found" — so a missing app-data dir never
/// aborts a chat turn.
#[derive(Debug, Clone, Default)]
pub struct SkillRuntime {
    pub skills_dir: PathBuf,
    pub workspace_root: PathBuf,
}

/// The tools this built-in server advertises.
pub fn tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "load_skill".to_string(),
            description: "Load the full instructions for one of the available skills (listed in \
                the system prompt by name). Call this when a skill is relevant to the user's \
                request, then follow its instructions."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "The skill's name, as listed in the skills index." }
                },
                "required": ["name"]
            }),
        },
        ToolDef {
            name: "read_skill_file".to_string(),
            description: "Read a file bundled inside a skill's folder (e.g. a template or \
                reference the skill's instructions point you to). Read-only."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "skill": { "type": "string", "description": "The skill's name." },
                    "path": { "type": "string", "description": "File path relative to the skill folder." }
                },
                "required": ["skill", "path"]
            }),
        },
        ToolDef {
            name: "list_workspace".to_string(),
            description: "List files in your scratch workspace for this conversation."
                .to_string(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "read_workspace_file".to_string(),
            description: "Read a file you previously wrote to this conversation's workspace."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path relative to the workspace." }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "write_workspace_file".to_string(),
            description: "Write (or overwrite) a file in this conversation's scratch workspace, \
                to keep working state across steps. Confined to the workspace."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path relative to the workspace." },
                    "content": { "type": "string", "description": "File contents to write." }
                },
                "required": ["path", "content"]
            }),
        },
    ]
}

/// Execute one `skill__*` tool. Errors return `Err`; the chat loop surfaces them
/// to the model as a failed `tool_result` (a bad call never aborts the turn).
pub async fn call_tool(
    rt: &SkillRuntime,
    thread_id: &str,
    tool: &str,
    args: &Value,
    _emit: super::LineSink<'_>,
) -> anyhow::Result<String> {
    match tool {
        "load_skill" => {
            let name = require_str(args, "name")?;
            skills::read_skill_body(&rt.skills_dir, name).map_err(|e| anyhow!(e))
        }
        "read_skill_file" => {
            let skill = require_str(args, "skill")?;
            let rel = require_str(args, "path")?;
            let folder = skills::skill_folder(&rt.skills_dir, skill)
                .ok_or_else(|| anyhow!("no skill named `{skill}`"))?;
            read_text(&folder, rel)
        }
        "list_workspace" => list_workspace(&workspace_dir(rt, thread_id)),
        "read_workspace_file" => {
            let rel = require_str(args, "path")?;
            read_text(&workspace_dir(rt, thread_id), rel)
        }
        "write_workspace_file" => {
            let rel = require_str(args, "path")?;
            let content = require_str(args, "content")?;
            write_workspace(&workspace_dir(rt, thread_id), rel, content)
        }
        other => Err(anyhow!("unknown skill tool: {other}")),
    }
}

fn workspace_dir(rt: &SkillRuntime, thread_id: &str) -> PathBuf {
    // thread_id is a DB row id (digits) — but slugify it defensively so it can
    // never escape the workspace root.
    rt.workspace_root.join(skills::slugify(thread_id))
}

fn require_str<'a>(args: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("missing required string argument `{key}`"))
}

/// Join `rel` under `root`, rejecting absolute paths and any `..`/root component.
/// Pure / unit-tested.
fn safe_join(root: &Path, rel: &str) -> anyhow::Result<PathBuf> {
    use std::path::Component;
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        bail!("path must be relative: {rel}");
    }
    for comp in rel_path.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            _ => bail!("path may not contain `..` or root components: {rel}"),
        }
    }
    Ok(root.join(rel_path))
}

/// Belt-and-braces against symlink escapes: once a path (or its parent) exists,
/// confirm it canonicalizes to somewhere within `root`.
fn verify_within(root: &Path, path: &Path) -> anyhow::Result<()> {
    let base = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let check = if path.exists() {
        path.canonicalize().ok()
    } else {
        path.parent().and_then(|p| p.canonicalize().ok())
    };
    if let Some(c) = check {
        if !c.starts_with(&base) {
            bail!("path escapes its sandbox");
        }
    }
    Ok(())
}

/// Read a UTF-8 text file confined to `root`, capped for the model.
fn read_text(root: &Path, rel: &str) -> anyhow::Result<String> {
    let path = safe_join(root, rel)?;
    verify_within(root, &path)?;
    let meta = std::fs::symlink_metadata(&path).with_context(|| format!("stat {rel}"))?;
    if meta.file_type().is_symlink() {
        bail!("{rel} is a symlink; refusing to follow it");
    }
    if meta.is_dir() {
        bail!("{rel} is a directory");
    }
    use std::io::Read;
    let mut buf = Vec::new();
    std::fs::File::open(&path)
        .with_context(|| format!("opening {rel}"))?
        .take(MAX_READ_BYTES)
        .read_to_end(&mut buf)
        .with_context(|| format!("reading {rel}"))?;
    if buf.iter().take(8192).any(|&b| b == 0) {
        return Ok(format!("[binary file, {} bytes — not shown]", meta.len()));
    }
    let mut out = cap_text(String::from_utf8_lossy(&buf).into_owned());
    if meta.len() > MAX_READ_BYTES {
        out.push_str(&format!(
            "\n[… file is {} bytes; showing first {MAX_READ_BYTES}]",
            meta.len()
        ));
    }
    Ok(out)
}

/// Write `content` to a file confined to the per-thread workspace.
fn write_workspace(ws: &Path, rel: &str, content: &str) -> anyhow::Result<String> {
    if content.len() > MAX_WRITE_BYTES {
        bail!("content exceeds {MAX_WRITE_BYTES} bytes");
    }
    let path = safe_join(ws, rel)?;
    std::fs::create_dir_all(ws).with_context(|| "creating workspace")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| "creating parent dir")?;
    }
    verify_within(ws, &path)?;
    std::fs::write(&path, content).with_context(|| format!("writing {rel}"))?;
    Ok(format!("Wrote {} bytes to {rel}.", content.len()))
}

/// List the per-thread workspace (flat names + sizes).
fn list_workspace(ws: &Path) -> anyhow::Result<String> {
    let read = match std::fs::read_dir(ws) {
        Ok(r) => r,
        Err(_) => return Ok("(workspace is empty)".to_string()),
    };
    let mut entries: Vec<(String, u64, bool)> = Vec::new();
    for entry in read.flatten() {
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        entries.push((entry.file_name().to_string_lossy().into_owned(), size, is_dir));
    }
    if entries.is_empty() {
        return Ok("(workspace is empty)".to_string());
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries.truncate(MAX_WS_ENTRIES);
    let mut out = String::new();
    for (name, size, is_dir) in entries {
        let suffix = if is_dir { "/" } else { "" };
        out.push_str(&format!("{size:>10}  {name}{suffix}\n"));
    }
    Ok(out)
}

fn cap_text(s: String) -> String {
    if s.chars().count() <= MAX_TEXT_LEN {
        return s;
    }
    let truncated: String = s.chars().take(MAX_TEXT_LEN).collect();
    format!("{truncated}\n[… output truncated at {MAX_TEXT_LEN} chars]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertises_expected_tools() {
        let names: Vec<_> = tools().into_iter().map(|t| t.name).collect();
        for want in [
            "load_skill",
            "read_skill_file",
            "list_workspace",
            "read_workspace_file",
            "write_workspace_file",
        ] {
            assert!(names.contains(&want.to_string()), "missing {want}");
        }
    }

    #[test]
    fn safe_join_allows_plain_relative() {
        let p = safe_join(Path::new("/root"), "a/b.txt").unwrap();
        assert_eq!(p, Path::new("/root/a/b.txt"));
    }

    #[test]
    fn safe_join_rejects_escapes() {
        assert!(safe_join(Path::new("/root"), "../etc/passwd").is_err());
        assert!(safe_join(Path::new("/root"), "/etc/passwd").is_err());
        assert!(safe_join(Path::new("/root"), "a/../../b").is_err());
    }

    #[test]
    fn workspace_round_trips_and_is_confined() {
        let tmp = std::env::temp_dir().join(format!("snak-skill-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let ws = tmp.join("ws");
        write_workspace(&ws, "notes/todo.txt", "hello").unwrap();
        let got = read_text(&ws, "notes/todo.txt").unwrap();
        assert_eq!(got, "hello");
        // Escape attempt is rejected before any write happens.
        assert!(write_workspace(&ws, "../escape.txt", "x").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
