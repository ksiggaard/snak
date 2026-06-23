//! Plugin host (T12 foundation).
//!
//! Provides discovery, manifest parsing/validation, and enable/disable/uninstall
//! lifecycle for plugins. This wave is **additive scaffolding**: it seeds the four
//! current providers as built-in *descriptors* (metadata only) and discovers
//! user plugins from an app-data directory. It does NOT replace the live
//! hardcoded providers — that swap is T18.
//!
//! ## Layering
//! Plugin discovery + enabled-state live in Rust because both touch the
//! filesystem / app-data dir (a backend concern per the project layer boundary).
//! Enabled state is persisted as `…/plugins/enabled.json`; this keeps the backend
//! authoritative for both discovery and enablement, which later waves (T18) need
//! to source the set of *enabled* providers.
//!
//! ## Security model
//! Plugins are **declarative**: a manifest plus static, non-executable assets
//! (CSS text, instruction strings, provider / slash-command *descriptors*). The
//! host never loads or executes arbitrary plugin code. Behavior for the
//! `provider` / `slash-command` categories is supplied by built-in Rust/TS keyed
//! by the manifest `id`; a user manifest can only *describe* a contribution.
//! Executable third-party plugins (which would need a real sandbox — WASM or a
//! permission-scoped subprocess) are explicitly out of scope; the manifest
//! `apiVersion` lets a future host gate on it.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Host API version this build implements. Manifests must target this version.
pub const API_VERSION: u32 = 1;

/// Where a plugin came from. Built-ins ship with the app and cannot be
/// uninstalled (only disabled); user plugins live in the app-data plugins dir.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginSource {
    Builtin,
    User,
}

/// A validated plugin manifest. Mirrors `PluginManifest` in
/// `src/types/plugins.ts`. `contributes` is an opaque (category-specific)
/// descriptor this wave only round-trips; later waves interpret it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    /// One of: provider | theme | slash-command | renderer | audio.
    /// (Skills are not plugins — they're SKILL.md folders; see `crate::skills`.)
    pub category: String,
    #[serde(rename = "apiVersion")]
    pub api_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, rename = "enabledByDefault")]
    pub enabled_by_default: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contributes: Option<serde_json::Value>,
}

/// A discovered plugin with its source and resolved enabled state.
#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub source: PluginSource,
    pub enabled: bool,
}

/// The known plugin categories.
const CATEGORIES: [&str; 5] = [
    "provider",
    "theme",
    "slash-command",
    "renderer",
    "audio",
];

/// Parse + validate a manifest from JSON text. Pure (no IO) so it is unit-tested.
/// Rejects unknown categories, blank required fields, and mismatched `apiVersion`.
pub fn parse_manifest(json: &str) -> Result<PluginManifest, String> {
    let manifest: PluginManifest =
        serde_json::from_str(json).map_err(|e| format!("invalid manifest JSON: {e}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

/// Validate a parsed manifest. Pure; shared by `parse_manifest` and built-ins.
pub fn validate_manifest(m: &PluginManifest) -> Result<(), String> {
    if m.id.trim().is_empty() {
        return Err("manifest `id` is required".into());
    }
    if m.name.trim().is_empty() {
        return Err("manifest `name` is required".into());
    }
    if m.version.trim().is_empty() {
        return Err("manifest `version` is required".into());
    }
    if !CATEGORIES.contains(&m.category.as_str()) {
        return Err(format!(
            "unknown plugin category `{}` (expected one of {})",
            m.category,
            CATEGORIES.join(", ")
        ));
    }
    if m.api_version != API_VERSION {
        return Err(format!(
            "plugin targets apiVersion {} but host implements {API_VERSION}",
            m.api_version
        ));
    }
    Ok(())
}

/// Built-in plugin descriptors seeded with the app. Metadata only this wave —
/// these do NOT drive the live providers yet (that is T18). Kept as raw JSON so
/// it flows through the same `parse_manifest` validation path as user plugins.
fn builtin_manifests() -> Vec<PluginManifest> {
    const BUILTINS: &[&str] = &[
        include_str!("builtin/anthropic.json"),
        include_str!("builtin/openai.json"),
        include_str!("builtin/mistral.json"),
        include_str!("builtin/gemini.json"),
        include_str!("builtin/ollama.json"),
        include_str!("builtin/terminal.json"),
        include_str!("builtin/mermaid.json"),
        include_str!("builtin/charts.json"),
        include_str!("builtin/youtube.json"),
        include_str!("builtin/artifacts.json"),
        include_str!("builtin/maps.json"),
        include_str!("builtin/audio.json"),
    ];
    BUILTINS
        .iter()
        .filter_map(|raw| parse_manifest(raw).ok())
        .collect()
}

/// App-data plugins directory (`…/plugins`). Created on demand.
fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("plugins");
    Ok(dir)
}

/// Path to the enabled-state file (`…/plugins/enabled.json`).
fn enabled_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(plugins_dir(app)?.join("enabled.json"))
}

/// Read the `{ id: bool }` enabled-state map. Missing/corrupt file → empty map.
fn read_enabled(app: &AppHandle) -> BTreeMap<String, bool> {
    let path = match enabled_file(app) {
        Ok(p) => p,
        Err(_) => return BTreeMap::new(),
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Persist the `{ id: bool }` enabled-state map.
fn write_enabled(app: &AppHandle, map: &BTreeMap<String, bool>) -> Result<(), String> {
    let dir = plugins_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("creating plugins dir: {e}"))?;
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("enabled.json"), json).map_err(|e| format!("writing enabled.json: {e}"))
}

/// Discover user plugins under `…/plugins/<id>/manifest.json`. Invalid manifests
/// are skipped (logged-ignored) rather than failing the whole listing.
fn discover_user_plugins(app: &AppHandle) -> Vec<PluginManifest> {
    let dir = match plugins_dir(app) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(), // dir not created yet → no user plugins
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let manifest_path = entry.path().join("manifest.json");
        if let Ok(text) = std::fs::read_to_string(&manifest_path) {
            if let Ok(m) = parse_manifest(&text) {
                out.push(m);
            }
        }
    }
    out
}

/// Resolve the enabled state for a manifest: explicit override, else default.
fn resolve_enabled(m: &PluginManifest, overrides: &BTreeMap<String, bool>) -> bool {
    overrides
        .get(&m.id)
        .copied()
        .unwrap_or(m.enabled_by_default)
}

/// List all plugins (built-ins + discovered user plugins) with enabled state.
#[tauri::command]
pub fn list_plugins(app: AppHandle) -> Result<Vec<PluginInfo>, String> {
    let overrides = read_enabled(&app);
    let mut out: Vec<PluginInfo> = Vec::new();

    for m in builtin_manifests() {
        let enabled = resolve_enabled(&m, &overrides);
        out.push(PluginInfo {
            manifest: m,
            source: PluginSource::Builtin,
            enabled,
        });
    }
    for m in discover_user_plugins(&app) {
        let enabled = resolve_enabled(&m, &overrides);
        out.push(PluginInfo {
            manifest: m,
            source: PluginSource::User,
            enabled,
        });
    }
    Ok(out)
}

/// Enable or disable a plugin by id (persisted in `enabled.json`).
#[tauri::command]
pub fn set_plugin_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let mut map = read_enabled(&app);
    map.insert(id, enabled);
    write_enabled(&app, &map)
}

/// Uninstall a *user* plugin (removes its folder). Built-ins reject this — they
/// can only be disabled.
#[tauri::command]
pub fn uninstall_plugin(app: AppHandle, id: String) -> Result<(), String> {
    if builtin_manifests().iter().any(|m| m.id == id) {
        return Err("built-in plugins cannot be uninstalled (disable it instead)".into());
    }
    let dir = plugins_dir(&app)?;
    // Find the folder whose manifest declares this id.
    let entries = std::fs::read_dir(&dir).map_err(|_| "no user plugins installed".to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let manifest_path = path.join("manifest.json");
        let matches = std::fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|t| parse_manifest(&t).ok())
            .map(|m| m.id == id)
            .unwrap_or(false);
        if matches {
            std::fs::remove_dir_all(&path).map_err(|e| format!("removing plugin: {e}"))?;
            // Drop any stale enabled override for the removed id.
            let mut map = read_enabled(&app);
            if map.remove(&id).is_some() {
                let _ = write_enabled(&app, &map);
            }
            return Ok(());
        }
    }
    Err(format!("no installed plugin with id `{id}`"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PluginManifest {
        PluginManifest {
            id: "com.example.x".into(),
            name: "X".into(),
            version: "1.0.0".into(),
            category: "provider".into(),
            api_version: API_VERSION,
            description: None,
            author: None,
            enabled_by_default: false,
            contributes: None,
        }
    }

    #[test]
    fn parses_a_valid_manifest() {
        let json = r#"{
            "id": "com.example.x", "name": "X", "version": "1.0.0",
            "category": "theme", "apiVersion": 1, "enabledByDefault": true
        }"#;
        let m = parse_manifest(json).expect("should parse");
        assert_eq!(m.id, "com.example.x");
        assert_eq!(m.category, "theme");
        assert!(m.enabled_by_default);
    }

    #[test]
    fn rejects_unknown_category() {
        let mut m = base();
        m.category = "wizardry".into();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn rejects_missing_id() {
        let mut m = base();
        m.id = "  ".into();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn rejects_wrong_api_version() {
        let mut m = base();
        m.api_version = 999;
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_manifest("{not json").is_err());
    }

    #[test]
    fn all_builtins_valid_with_expected_default_enablement() {
        let builtins = builtin_manifests();
        // Five provider plugins (T18/T37) + the /terminal slash-command plugin
        // (T14) + five renderer plugins: mermaid (T42), charts, youtube,
        // artifacts, and maps (disabled by default) + the audio plugin
        // (TTS/STT, disabled by default).
        assert_eq!(builtins.len(), 12, "expected 12 built-in plugins");
        let providers = builtins.iter().filter(|m| m.category == "provider").count();
        assert_eq!(providers, 5, "expected 5 built-in providers");
        for m in &builtins {
            validate_manifest(m).expect("built-in must validate");
            if m.id == "com.snak.maps" || m.id == "com.snak.audio" {
                assert!(!m.enabled_by_default, "maps and audio default disabled");
            } else {
                assert!(m.enabled_by_default, "other built-ins default enabled");
            }
        }
        // The audio built-in is present (category `audio`) and disabled by default.
        assert!(
            builtins.iter().any(|m| m.category == "audio"
                && m.id == "com.snak.audio"
                && !m.enabled_by_default),
            "expected the built-in audio plugin (disabled by default)",
        );
        // The maps renderer built-in is present, contributes the map language,
        // and is disabled by default.
        assert!(
            builtins.iter().any(|m| m.category == "renderer"
                && m.id == "com.snak.maps"
                && !m.enabled_by_default),
            "expected the built-in maps renderer plugin (disabled by default)",
        );
        // The slash-command built-in is present and contributes /terminal.
        assert!(
            builtins
                .iter()
                .any(|m| m.category == "slash-command" && m.id == "com.snak.terminal"),
            "expected the built-in /terminal slash-command plugin",
        );
        // The renderer built-in is present and contributes the mermaid language.
        assert!(
            builtins
                .iter()
                .any(|m| m.category == "renderer" && m.id == "com.snak.mermaid"),
            "expected the built-in mermaid renderer plugin",
        );
    }

    #[test]
    fn resolve_enabled_uses_override_then_default() {
        let mut m = base();
        m.enabled_by_default = true;
        let mut overrides = BTreeMap::new();
        assert!(resolve_enabled(&m, &overrides)); // default true
        overrides.insert(m.id.clone(), false);
        assert!(!resolve_enabled(&m, &overrides)); // override wins
    }
}
