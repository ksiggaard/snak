//! Global quick-input overlay: a frameless always-on-top window summoned by a
//! global shortcut. It captures text + images and hands them to the main window
//! (which owns the chat/DB logic) via the `quick-submit` event.

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Show + center + focus the quick-input overlay. Called by the shortcut handler.
pub fn show_quick(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn hide_quick_inner(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.hide();
    }
}

fn focus_main_inner(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn hide_quick(app: AppHandle) {
    hide_quick_inner(&app);
}

/// Forward the overlay's input to the main window and bring it to the front.
#[tauri::command]
pub fn submit_quick(app: AppHandle, payload: serde_json::Value) -> Result<(), String> {
    app.emit_to("main", "quick-submit", payload)
        .map_err(|e| e.to_string())?;
    focus_main_inner(&app);
    hide_quick_inner(&app);
    Ok(())
}

/// (Re)register the global shortcut, replacing any previous one.
#[tauri::command]
pub fn set_global_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(accelerator.as_str()).map_err(|e| e.to_string())
}

/// Interactive region screenshot, returned as base64. `None` if the user
/// cancelled. The overlay is hidden during capture so it isn't in the shot.
#[tauri::command]
pub fn take_screenshot(app: AppHandle) -> Result<Option<String>, String> {
    let was_visible = app
        .get_webview_window("quick")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if was_visible {
        hide_quick_inner(&app);
    }

    let result = capture_interactive();

    if was_visible {
        show_quick(&app);
    }
    result
}

fn temp_png_path() -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("kde-llm-shot-{nanos}.png"))
}

fn read_and_encode(path: &std::path::Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None); // user cancelled the selection
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(path);
    if bytes.is_empty() {
        return Ok(None);
    }
    Ok(Some(STANDARD.encode(bytes)))
}

#[cfg(target_os = "macos")]
fn capture_interactive() -> Result<Option<String>, String> {
    let path = temp_png_path();
    std::process::Command::new("screencapture")
        .args(["-i", "-t", "png"])
        .arg(&path)
        .status()
        .map_err(|e| format!("failed to run screencapture: {e}"))?;
    read_and_encode(&path)
}

#[cfg(target_os = "linux")]
fn capture_interactive() -> Result<Option<String>, String> {
    // KDE's Spectacle: region (-r), background (-b), no-notify (-n), output (-o).
    let path = temp_png_path();
    std::process::Command::new("spectacle")
        .args(["-r", "-b", "-n", "-o"])
        .arg(&path)
        .status()
        .map_err(|e| format!("failed to run spectacle (is it installed?): {e}"))?;
    read_and_encode(&path)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn capture_interactive() -> Result<Option<String>, String> {
    Err("screenshots are not supported on this platform yet".into())
}
