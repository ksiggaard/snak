//! User-installable themes (T11).
//!
//! A theme is a **folder** under the app-data themes directory:
//!
//! ```text
//! …/themes/<id>/theme.json   # manifest: { name, author?, version }
//! …/themes/<id>/theme.css    # CSS overriding the documented variables
//! ```
//!
//! Rust owns discovery because it touches the filesystem / app-data dir (a
//! backend concern per the project layer boundary). The frontend lists themes,
//! selects one, injects its CSS into a `<style>` element, and persists the
//! choice. Applying a theme composes with the existing light/dark toggle: theme
//! CSS only overrides the documented `--*` variables, so the `.dark` class still
//! flips the base palette and the theme re-tints on top.
//!
//! ## Security model
//! Themes are **declarative, CSS-only** assets. The host reads `theme.css` as
//! text and hands it to the webview, which injects it via a `<style>` element —
//! never `eval`, never `<script>`, never a remote `@import`. The same posture as
//! the plugin host's `theme` category.
//!
//! ## Relationship to the T12 plugin registry
//! The plugin host's `theme` category contributes `{ name, css }` where `css` is
//! *inline* in a `manifest.json`. T11's required on-disk format is a folder with
//! a separate `theme.json` + `theme.css` file, which the plugin host does not
//! load (it reads `manifest.json` only). Rather than modify plugin-host
//! internals, this is a parallel, focused loader for the documented folder
//! format; both feed the same frontend selector.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Manifest fields a theme author declares in `theme.json`.
/// `author` is optional; `name` and `version` are required.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ThemeManifest {
    pub name: String,
    #[serde(default)]
    pub author: Option<String>,
    pub version: String,
}

/// A discovered, validated theme: its folder id, manifest, and CSS text.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct InstalledTheme {
    /// The folder name under `…/themes/`; the stable selection key.
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub version: String,
    /// The full CSS text from `theme.css`, ready to inject into a `<style>`.
    pub css: String,
}

/// Parse + validate a `theme.json` manifest from JSON text. Pure (no IO), so it
/// is unit-tested. Rejects malformed JSON and blank required fields.
pub fn parse_theme_manifest(json: &str) -> Result<ThemeManifest, String> {
    let manifest: ThemeManifest =
        serde_json::from_str(json).map_err(|e| format!("invalid theme.json: {e}"))?;
    validate_theme_manifest(&manifest)?;
    Ok(manifest)
}

/// Validate a parsed manifest. Pure; shared by the loader and tests.
pub fn validate_theme_manifest(m: &ThemeManifest) -> Result<(), String> {
    if m.name.trim().is_empty() {
        return Err("theme.json `name` is required".into());
    }
    if m.version.trim().is_empty() {
        return Err("theme.json `version` is required".into());
    }
    Ok(())
}

/// App-data themes directory (`…/themes`). Not created here — discovery tolerates
/// a missing directory (returns no themes).
fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("themes");
    Ok(dir)
}

/// List installed themes from `…/themes/<id>/`. Each folder must contain a
/// `theme.json` and a `theme.css`; invalid/incomplete folders are skipped rather
/// than failing the whole listing. Returned sorted by id for a stable UI order.
#[tauri::command]
pub fn list_themes(app: AppHandle) -> Result<Vec<InstalledTheme>, String> {
    let dir = themes_dir(&app)?;
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()), // dir not created yet → no themes
    };
    let mut out: Vec<InstalledTheme> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let manifest = match std::fs::read_to_string(path.join("theme.json")) {
            Ok(text) => match parse_theme_manifest(&text) {
                Ok(m) => m,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        let css = match std::fs::read_to_string(path.join("theme.css")) {
            Ok(c) => c,
            Err(_) => continue, // a theme without CSS contributes nothing
        };
        out.push(InstalledTheme {
            id,
            name: manifest.name,
            author: manifest.author,
            version: manifest.version,
            css,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Return the absolute path of the themes directory (so the UI can tell the user
/// where to drop theme folders). Creates it on demand so the path always exists.
#[tauri::command]
pub fn themes_directory(app: AppHandle) -> Result<String, String> {
    let dir = themes_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("creating themes dir: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_manifest() {
        let json = r#"{ "name": "Solarized", "author": "Ethan", "version": "1.2.0" }"#;
        let m = parse_theme_manifest(json).expect("should parse");
        assert_eq!(m.name, "Solarized");
        assert_eq!(m.author.as_deref(), Some("Ethan"));
        assert_eq!(m.version, "1.2.0");
    }

    #[test]
    fn author_is_optional() {
        let json = r#"{ "name": "Mono", "version": "0.1.0" }"#;
        let m = parse_theme_manifest(json).expect("should parse without author");
        assert_eq!(m.author, None);
    }

    #[test]
    fn rejects_blank_name() {
        let json = r#"{ "name": "   ", "version": "1.0.0" }"#;
        assert!(parse_theme_manifest(json).is_err());
    }

    #[test]
    fn rejects_missing_version() {
        let json = r#"{ "name": "X" }"#;
        assert!(parse_theme_manifest(json).is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_theme_manifest("{not json").is_err());
    }
}
