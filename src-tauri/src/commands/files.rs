use base64::Engine;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Save a base64-encoded image to a user-chosen location via a native
/// "Save as…" dialog (T44). The bytes are written from Rust (the webview only
/// holds the base64 string), so no JS filesystem capability is involved.
///
/// Returns `true` if the file was written, `false` if the user cancelled the
/// dialog. Decode/IO failures surface as an `Err` string to the frontend.
#[tauri::command]
pub fn save_image(app: AppHandle, data: String, suggested_name: String) -> Result<bool, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Could not decode image: {e}"))?;

    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .blocking_save_file()
    else {
        return Ok(false); // user cancelled
    };

    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write file: {e}"))?;
    Ok(true)
}
