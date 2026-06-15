//! Artifact export commands: save a multi-file web app to a `.zip` on disk, and
//! open the assembled preview in the system browser. The webview holds the file
//! contents; the bytes are written from Rust (no JS filesystem capability), and
//! the temp filename is app-controlled (never model input).

use std::io::{Cursor, Write};

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// One artifact file as sent from the frontend. Top-level command args are
/// camelCase-converted by Tauri, but these nested fields are not — they arrive
/// snake_case (`path`, `content`), which already matches.
#[derive(Deserialize)]
pub struct ArtifactFileArg {
    pub path: String,
    pub content: String,
}

/// Reject paths that could escape the archive root (absolute or `..`-bearing).
fn safe_relative(path: &str) -> Result<String, String> {
    let normalized = path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("empty file path in artifact".into());
    }
    if normalized.starts_with('/') {
        return Err(format!("unsafe absolute path: {path}"));
    }
    if normalized.split('/').any(|seg| seg == "..") {
        return Err(format!("unsafe path traversal: {path}"));
    }
    Ok(normalized)
}

/// Save an artifact's files to a user-chosen `.zip` via a native "Save as…"
/// dialog. Returns `true` if written, `false` if the user cancelled.
#[tauri::command]
pub fn export_artifact_zip(
    app: AppHandle,
    files: Vec<ArtifactFileArg>,
    suggested_name: String,
) -> Result<bool, String> {
    if files.is_empty() {
        return Err("artifact has no files to export".into());
    }

    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    for f in &files {
        let name = safe_relative(&f.path)?;
        writer
            .start_file(name, options)
            .map_err(|e| format!("zip error: {e}"))?;
        writer
            .write_all(f.content.as_bytes())
            .map_err(|e| format!("zip write error: {e}"))?;
    }
    let bytes = writer
        .finish()
        .map_err(|e| format!("zip finalize error: {e}"))?
        .into_inner();

    let name = if suggested_name.trim().is_empty() {
        "artifact.zip".to_string()
    } else {
        suggested_name
    };
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .blocking_save_file()
    else {
        return Ok(false); // user cancelled
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write file: {e}"))?;
    Ok(true)
}

/// A unique temp path: `<tmp>/<prefix>-<nanos>.<ext>` (app-controlled).
fn temp_path(prefix: &str, ext: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{prefix}-{nanos}.{ext}"))
}

/// Write the assembled artifact HTML to a temp file and open it in the system
/// browser via the opener plugin.
#[tauri::command]
pub fn open_artifact_in_browser(app: AppHandle, html: String) -> Result<(), String> {
    let path = temp_path("snak-artifact", "html");
    std::fs::write(&path, html.as_bytes())
        .map_err(|e| format!("Could not write preview file: {e}"))?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Could not open preview: {e}"))?;
    Ok(())
}
