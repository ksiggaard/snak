//! User-installable language packs (T32).
//!
//! A language pack is a **single JSON file** under the app-data languages
//! directory, named after its BCP 47 code:
//!
//! ```text
//! …/languages/<bcp47>.json   # { "name": "Deutsch", "code": "de", "strings": { key: text } }
//! ```
//!
//! Rust owns discovery because it touches the filesystem / app-data dir (a
//! backend concern per the project layer boundary) — this mirrors the T11
//! themes loader (`commands/themes.rs`). The frontend merges discovered packs
//! with the bundled ones (`src/store/i18n.ts`), applies the selected locale,
//! and persists the choice in localStorage.
//!
//! ## Relationship to the T12 plugin registry (decision)
//! No `language` plugin category is added. Packs are plain data files in a
//! dedicated folder, exactly like T11's theme folders — a parallel, focused
//! loader rather than a plugin-host extension. Packs are **declarative,
//! text-only** assets (a map of strings); nothing is executed.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

/// A language pack as authored on disk. `strings` maps catalog keys to
/// translated text; unknown keys are ignored and missing keys fall back to
/// English on the frontend.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct LanguagePack {
    /// Native display name shown in the selector, e.g. "Deutsch".
    pub name: String,
    /// BCP 47 code, e.g. "de" — the selection key and `Intl` locale.
    pub code: String,
    /// Catalog-key → translated text.
    pub strings: BTreeMap<String, String>,
}

/// Parse + validate a language pack from JSON text. Pure (no IO), unit-tested.
pub fn parse_language_pack(json: &str) -> Result<LanguagePack, String> {
    let pack: LanguagePack =
        serde_json::from_str(json).map_err(|e| format!("invalid language pack: {e}"))?;
    validate_language_pack(&pack)?;
    Ok(pack)
}

/// Validate a parsed pack. Pure; shared by the loader and tests.
pub fn validate_language_pack(p: &LanguagePack) -> Result<(), String> {
    if p.name.trim().is_empty() {
        return Err("language pack `name` is required".into());
    }
    if !is_valid_code(&p.code) {
        return Err(format!(
            "language pack `code` is not a BCP 47 tag: {:?}",
            p.code
        ));
    }
    Ok(())
}

/// A plausible BCP 47 tag: letter subtags of 2–8 chars joined by `-` with
/// alphanumeric extensions ("de", "pt-BR", "sr-Latn"). Mirrors `isValidCode`
/// in `src/lib/i18n.ts`.
fn is_valid_code(code: &str) -> bool {
    let mut parts = code.split('-');
    let primary = match parts.next() {
        Some(p) => p,
        None => return false,
    };
    if primary.len() < 2 || primary.len() > 8 || !primary.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    parts.all(|s| !s.is_empty() && s.len() <= 8 && s.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// App-data languages directory (`…/languages`). Not created here — discovery
/// tolerates a missing directory (returns no packs).
fn languages_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("languages");
    Ok(dir)
}

/// List installed language packs from `…/languages/*.json`. Invalid files are
/// skipped rather than failing the whole listing. Returned sorted by code for
/// a stable UI order.
#[tauri::command]
pub fn list_languages(app: AppHandle) -> Result<Vec<LanguagePack>, String> {
    let dir = languages_dir(&app)?;
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()), // dir not created yet → no packs
    };
    let mut out: Vec<LanguagePack> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let pack = match std::fs::read_to_string(&path) {
            Ok(text) => match parse_language_pack(&text) {
                Ok(p) => p,
                Err(_) => continue, // malformed/invalid file → skip
            },
            Err(_) => continue,
        };
        out.push(pack);
    }
    out.sort_by(|a, b| a.code.cmp(&b.code));
    Ok(out)
}

/// Return the absolute path of the languages directory (so the UI can tell the
/// user where to drop packs). Creates it on demand so the path always exists.
#[tauri::command]
pub fn languages_directory(app: AppHandle) -> Result<String, String> {
    let dir = languages_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("creating languages dir: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_pack() {
        let json =
            r#"{ "name": "Deutsch", "code": "de", "strings": { "common.save": "Speichern" } }"#;
        let p = parse_language_pack(json).expect("should parse");
        assert_eq!(p.name, "Deutsch");
        assert_eq!(p.code, "de");
        assert_eq!(
            p.strings.get("common.save").map(String::as_str),
            Some("Speichern")
        );
    }

    #[test]
    fn accepts_an_empty_strings_map() {
        let json = r#"{ "name": "English", "code": "en", "strings": {} }"#;
        let p = parse_language_pack(json).expect("empty strings are valid");
        assert!(p.strings.is_empty());
    }

    #[test]
    fn accepts_a_regional_code() {
        let json = r#"{ "name": "Português (Brasil)", "code": "pt-BR", "strings": {} }"#;
        assert!(parse_language_pack(json).is_ok());
    }

    #[test]
    fn rejects_blank_name() {
        let json = r#"{ "name": "  ", "code": "de", "strings": {} }"#;
        assert!(parse_language_pack(json).is_err());
    }

    #[test]
    fn rejects_a_bad_code() {
        for code in ["", "d", "de_DE", "de DE", "123"] {
            let json = format!(r#"{{ "name": "X", "code": "{code}", "strings": {{}} }}"#);
            assert!(
                parse_language_pack(&json).is_err(),
                "code {code:?} should be rejected"
            );
        }
    }

    #[test]
    fn rejects_missing_strings_field() {
        let json = r#"{ "name": "X", "code": "de" }"#;
        assert!(parse_language_pack(json).is_err());
    }

    #[test]
    fn rejects_non_string_values() {
        let json = r#"{ "name": "X", "code": "de", "strings": { "a": 1 } }"#;
        assert!(parse_language_pack(json).is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_language_pack("{not json").is_err());
    }
}
