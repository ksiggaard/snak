//! Skills store — the Anthropic **Agent Skills** standard (`SKILL.md`).
//!
//! A skill is a folder `…/skills/<slug>/SKILL.md` with YAML-ish frontmatter
//! (`name`, `description`) followed by a markdown body. Discovery + enabled-state
//! live in Rust (filesystem), exactly like [`crate::plugins`].
//!
//! ## Progressive disclosure
//! Only the **index** (`name` + `description`) is ever injected into the system
//! prompt (see the frontend `buildSkillsIndexText`). The body is loaded **on
//! demand** by the model through the built-in `skill__load_skill` tool
//! ([`crate::mcp::skill_tool`]) — so a dozen skills cost a dozen lines of context,
//! not a dozen full instruction packs.
//!
//! ## Harness compatibility
//! The on-disk shape is the same `SKILL.md` format used by Claude Code, the
//! Claude API, and the Agent SDK, so a `~/.claude/skills/<x>` folder is drop-in
//! (see [`import_skills`]).
//!
//! ## Security model (consistent with the declarative plugin model)
//! Skills are instructions + data the model *reads*; snak never **executes**
//! skill-bundled code. Reads are confined to the skill's own folder and writes to
//! a per-thread workspace — both enforced in [`crate::mcp::skill_tool`].

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// App-data subdirectory holding the skill folders.
const SKILLS_DIRNAME: &str = "skills";
/// App-data subdirectory holding per-thread skill scratch space (Phase 2).
pub const WORKSPACE_DIRNAME: &str = "skill-workspace";
/// The skill definition filename inside each skill folder.
const SKILL_FILE: &str = "SKILL.md";
/// Cap on a saved skill body, so the editor can't write an unbounded file.
const MAX_BODY_BYTES: usize = 256 * 1024;

/// Skill metadata for the index + settings UI. The body is fetched separately
/// (`read_skill` / the `load_skill` tool) so it never rides in the index.
#[derive(Debug, Clone, Serialize)]
pub struct SkillMeta {
    /// Canonical name (frontmatter `name`, else the folder slug). The identity
    /// the model calls `load_skill` with, and the enable-state key.
    pub name: String,
    pub description: String,
    pub enabled: bool,
    /// Folder name on disk (for edit/delete; not shown to the model).
    pub slug: String,
}

/// A parsed `SKILL.md`: the two index fields + the markdown body. Pure / tested.
#[derive(Debug, Default, PartialEq)]
pub struct ParsedSkill {
    pub name: Option<String>,
    pub description: Option<String>,
    pub body: String,
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// `…/skills` (created on demand by writers).
pub fn skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join(SKILLS_DIRNAME))
}

/// `…/skill-workspace` — root of the per-thread scratch dirs (Phase 2).
pub fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join(WORKSPACE_DIRNAME))
}

// ---------------------------------------------------------------------------
// Parsing (pure)
// ---------------------------------------------------------------------------

/// Split a `SKILL.md` into its frontmatter index fields + body. The frontmatter
/// is an optional leading `---` … `---` block; `name`/`description` are read as
/// single-line `key: value` pairs (quotes stripped). Anything without a closing
/// fence is treated as a bodiless-frontmatter file → the whole text is the body.
pub fn parse_skill_md(text: &str) -> ParsedSkill {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text); // drop UTF-8 BOM
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return ParsedSkill {
            body: text.to_string(),
            ..Default::default()
        };
    }
    let mut fm = String::new();
    let mut body: Vec<&str> = Vec::new();
    let mut closed = false;
    for line in lines {
        if !closed && line.trim() == "---" {
            closed = true;
            continue;
        }
        if closed {
            body.push(line);
        } else {
            fm.push_str(line);
            fm.push('\n');
        }
    }
    if !closed {
        // No closing fence — treat the whole file as body (no usable index).
        return ParsedSkill {
            body: text.to_string(),
            ..Default::default()
        };
    }
    let (name, description) = parse_fm_fields(&fm);
    ParsedSkill {
        name,
        description,
        body: body.join("\n").trim_start_matches(['\r', '\n']).to_string(),
    }
}

/// Extract `name` / `description` from the frontmatter block (single-line values).
fn parse_fm_fields(fm: &str) -> (Option<String>, Option<String>) {
    let mut name = None;
    let mut description = None;
    for line in fm.lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let val = unquote(v.trim());
        if val.is_empty() {
            continue;
        }
        match k.trim().to_ascii_lowercase().as_str() {
            "name" => name = Some(val),
            "description" => description = Some(val),
            _ => {}
        }
    }
    (name, description)
}

/// Strip a single layer of matching single/double quotes.
fn unquote(s: &str) -> String {
    let b = s.as_bytes();
    if b.len() >= 2
        && ((b[0] == b'"' && b[b.len() - 1] == b'"') || (b[0] == b'\'' && b[b.len() - 1] == b'\''))
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// A filesystem-safe folder name derived from a skill name. Pure / tested.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() {
        "skill".to_string()
    } else {
        s
    }
}

/// Render a `SKILL.md` from the editable fields. Double-quotes the index values
/// so a `:` in the name/description can't break the frontmatter.
fn render_skill_md(name: &str, description: &str, body: &str) -> String {
    format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}\n",
        yaml_quote(name),
        yaml_quote(description),
        body.trim()
    )
}

fn yaml_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

// ---------------------------------------------------------------------------
// Enabled-state map (mirrors plugins/enabled.json)
// ---------------------------------------------------------------------------

fn enabled_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(skills_dir(app)?.join("enabled.json"))
}

fn read_enabled(app: &AppHandle) -> BTreeMap<String, bool> {
    enabled_file(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_enabled(app: &AppHandle, map: &BTreeMap<String, bool>) -> Result<(), String> {
    let dir = skills_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("creating skills dir: {e}"))?;
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("enabled.json"), json).map_err(|e| format!("writing enabled.json: {e}"))
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/// Discover `<dir>/<slug>/SKILL.md` skills. Unreadable / unparsable entries are
/// skipped rather than failing the listing. Returns `(slug, parsed)` pairs.
fn discover(dir: &Path) -> Vec<(String, ParsedSkill)> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(), // dir not created yet → no skills
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path.join(SKILL_FILE)) else {
            continue;
        };
        let slug = entry.file_name().to_string_lossy().into_owned();
        out.push((slug, parse_skill_md(&text)));
    }
    out
}

/// The canonical name for a discovered skill (frontmatter `name`, else slug).
fn skill_name(slug: &str, parsed: &ParsedSkill) -> String {
    parsed
        .name
        .as_ref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| slug.to_string())
}

/// Read a skill's body by name (case-insensitive), for the `load_skill` tool.
/// Takes the resolved `skills_dir` so the chat runtime needn't hold an `AppHandle`.
pub fn read_skill_body(skills_dir: &Path, name: &str) -> Result<String, String> {
    let want = name.trim().to_ascii_lowercase();
    for (slug, parsed) in discover(skills_dir) {
        if skill_name(&slug, &parsed).to_ascii_lowercase() == want {
            return Ok(parsed.body);
        }
    }
    Err(format!("no skill named `{name}`"))
}

/// Resolve the on-disk folder for a skill name (case-insensitive).
fn slug_for_name(skills_dir: &Path, name: &str) -> Option<String> {
    let want = name.trim().to_ascii_lowercase();
    discover(skills_dir)
        .into_iter()
        .find(|(slug, p)| skill_name(slug, p).to_ascii_lowercase() == want)
        .map(|(slug, _)| slug)
}

/// The folder backing a skill name (for reading its bundled files). Public so the
/// chat-time `skill__read_skill_file` tool can confine reads to it.
pub fn skill_folder(skills_dir: &Path, name: &str) -> Option<PathBuf> {
    slug_for_name(skills_dir, name).map(|slug| skills_dir.join(slug))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List discovered skills (name, description, enabled). Default-enabled unless an
/// explicit override turned a skill off.
#[tauri::command]
pub fn list_skills(app: AppHandle) -> Result<Vec<SkillMeta>, String> {
    let dir = skills_dir(&app)?;
    let overrides = read_enabled(&app);
    let mut out: Vec<SkillMeta> = discover(&dir)
        .into_iter()
        .map(|(slug, parsed)| {
            let name = skill_name(&slug, &parsed);
            let enabled = overrides.get(&name).copied().unwrap_or(true);
            SkillMeta {
                description: parsed.description.unwrap_or_default(),
                name,
                enabled,
                slug,
            }
        })
        .collect();
    out.sort_by_key(|s| s.name.to_ascii_lowercase());
    Ok(out)
}

/// Read a skill's full markdown body (the editor + a preview use this).
#[tauri::command]
pub fn read_skill(app: AppHandle, name: String) -> Result<String, String> {
    read_skill_body(&skills_dir(&app)?, &name)
}

/// Create or update a skill. `slug` is passed when editing an existing skill
/// (its folder is reused / renamed); on create the folder is derived from `name`.
/// Returns the on-disk slug.
#[tauri::command]
pub fn save_skill(
    app: AppHandle,
    name: String,
    description: String,
    body: String,
    slug: Option<String>,
) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("skill name is required".into());
    }
    if body.len() > MAX_BODY_BYTES {
        return Err(format!("skill body exceeds {MAX_BODY_BYTES} bytes"));
    }
    let dir = skills_dir(&app)?;
    let target_slug = slugify(&name);
    let folder = dir.join(&target_slug);
    std::fs::create_dir_all(&folder).map_err(|e| format!("creating skill folder: {e}"))?;
    std::fs::write(
        folder.join(SKILL_FILE),
        render_skill_md(&name, &description, &body),
    )
    .map_err(|e| format!("writing {SKILL_FILE}: {e}"))?;

    // Editing a skill whose name (and therefore slug) changed: drop the old
    // folder so we don't leave an orphan copy behind.
    if let Some(old) = slug {
        if old != target_slug && !old.trim().is_empty() {
            let _ = std::fs::remove_dir_all(dir.join(old));
        }
    }
    Ok(target_slug)
}

/// Delete a user skill (removes its folder) and drop any enable override.
#[tauri::command]
pub fn delete_skill(app: AppHandle, name: String) -> Result<(), String> {
    let dir = skills_dir(&app)?;
    let slug =
        slug_for_name(&dir, &name).ok_or_else(|| format!("no skill named `{name}`"))?;
    std::fs::remove_dir_all(dir.join(slug)).map_err(|e| format!("removing skill: {e}"))?;
    let mut map = read_enabled(&app);
    if map.remove(&name).is_some() {
        let _ = write_enabled(&app, &map);
    }
    Ok(())
}

/// Enable/disable a skill (persisted, keyed by name).
#[tauri::command]
pub fn set_skill_enabled(app: AppHandle, name: String, enabled: bool) -> Result<(), String> {
    let mut map = read_enabled(&app);
    map.insert(name, enabled);
    write_enabled(&app, &map)
}

/// Import skills from a directory. `dir` may be a single skill folder (contains
/// `SKILL.md`) or a parent of skill folders (e.g. `~/.claude/skills`). Copies each
/// into snak's skills dir. Returns the number imported.
#[tauri::command]
pub fn import_skills(app: AppHandle, dir: String) -> Result<usize, String> {
    let src = PathBuf::from(&dir);
    if !src.is_dir() {
        return Err(format!("not a directory: {dir}"));
    }
    let dest_root = skills_dir(&app)?;
    std::fs::create_dir_all(&dest_root).map_err(|e| format!("creating skills dir: {e}"))?;

    // Single skill folder vs. a parent-of-skills.
    let sources: Vec<PathBuf> = if src.join(SKILL_FILE).is_file() {
        vec![src.clone()]
    } else {
        std::fs::read_dir(&src)
            .map_err(|e| format!("reading {dir}: {e}"))?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir() && p.join(SKILL_FILE).is_file())
            .collect()
    };

    let mut count = 0usize;
    for skill_src in sources {
        let text = std::fs::read_to_string(skill_src.join(SKILL_FILE)).unwrap_or_default();
        let parsed = parse_skill_md(&text);
        let folder_name = skill_src
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let slug = slugify(&skill_name(&folder_name, &parsed));
        copy_dir(&skill_src, &dest_root.join(slug)).map_err(|e| format!("copying skill: {e}"))?;
        count += 1;
    }
    Ok(count)
}

/// Open a native folder picker and return the chosen path (None if cancelled).
/// Used by the Skills card's "Import" button — folder selection happens in Rust
/// (the JS dialog plugin isn't wired in), matching `save_image`.
///
/// **Async + the non-blocking `pick_folder` callback** is load-bearing: a *sync*
/// command runs on the main thread, and `blocking_pick_folder` blocks that thread
/// while the dialog needs it to pump its event loop → deadlock (app lockup on
/// macOS). Awaiting a oneshot off the main thread keeps the UI responsive.
#[tauri::command]
pub async fn pick_skills_dir(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    let Some(fp) = rx.await.map_err(|_| "dialog cancelled".to_string())? else {
        return Ok(None);
    };
    Ok(Some(
        fp.into_path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned(),
    ))
}

/// Recursively copy `src` into `dest` (files + subdirs). Used by import.
fn copy_dir(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_and_body() {
        let md = "---\nname: SQL Style\ndescription: \"House SQL conventions\"\n---\n\nUse uppercase keywords.\n";
        let p = parse_skill_md(md);
        assert_eq!(p.name.as_deref(), Some("SQL Style"));
        assert_eq!(p.description.as_deref(), Some("House SQL conventions"));
        assert_eq!(p.body, "Use uppercase keywords.");
    }

    #[test]
    fn no_frontmatter_is_all_body() {
        let p = parse_skill_md("just instructions, no fence");
        assert_eq!(p.name, None);
        assert_eq!(p.description, None);
        assert_eq!(p.body, "just instructions, no fence");
    }

    #[test]
    fn unterminated_frontmatter_is_all_body() {
        let md = "---\nname: X\nno closing fence here";
        let p = parse_skill_md(md);
        assert_eq!(p.name, None);
        assert_eq!(p.body, md);
    }

    #[test]
    fn render_round_trips_through_parse() {
        let md = render_skill_md("My Skill", "Does a thing: nicely", "Body line 1\nBody line 2");
        let p = parse_skill_md(&md);
        assert_eq!(p.name.as_deref(), Some("My Skill"));
        // The `:` in the description survives because it's quoted.
        assert_eq!(p.description.as_deref(), Some("Does a thing: nicely"));
        assert_eq!(p.body, "Body line 1\nBody line 2");
    }

    #[test]
    fn slugify_is_filesystem_safe() {
        assert_eq!(slugify("SQL Style!"), "sql-style");
        assert_eq!(slugify("  a/b\\c  "), "a-b-c");
        assert_eq!(slugify("***"), "skill");
        assert_eq!(slugify("Already-Slug"), "already-slug");
    }

    #[test]
    fn strips_bom_before_fence() {
        let p = parse_skill_md("\u{feff}---\nname: B\n---\nbody");
        assert_eq!(p.name.as_deref(), Some("B"));
        assert_eq!(p.body, "body");
    }
}
