//! Global quick-input overlay: a frameless always-on-top window summoned by a
//! global shortcut. It captures text + images and hands them to the main window
//! (which owns the chat/DB logic) via the `quick-submit` event.

use base64::{engine::general_purpose::STANDARD, Engine};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Whether the overlay has been placed yet this session. Once it has (on the
/// first show), we leave it wherever it sits — so a user drag sticks until the
/// app restarts, at which point it returns to the lower-middle default.
static POSITIONED: AtomicBool = AtomicBool::new(false);

/// Fraction of the monitor height at which the overlay's *bottom* edge sits by
/// default ("lower-middle"). The panel grows upward from this anchor.
const BOTTOM_ANCHOR_FRAC: f64 = 0.80;

/// Place the overlay horizontally centered with its bottom edge at
/// `BOTTOM_ANCHOR_FRAC` of the monitor height. Falls back to the OS center if
/// monitor info is unavailable.
fn position_lower_middle(w: &WebviewWindow) {
    let Ok(Some(monitor)) = w.current_monitor() else {
        let _ = w.center();
        return;
    };
    let scale = monitor.scale_factor();
    let msize = monitor.size().to_logical::<f64>(scale);
    let mpos = monitor.position().to_logical::<f64>(scale);
    let wsize = w
        .outer_size()
        .map(|s| s.to_logical::<f64>(scale))
        .unwrap_or_else(|_| LogicalSize::new(640.0, 120.0));
    let x = mpos.x + (msize.width - wsize.width) / 2.0;
    let bottom = mpos.y + msize.height * BOTTOM_ANCHOR_FRAC;
    let _ = w.set_position(LogicalPosition::new(x, bottom - wsize.height));
}

/// Show + focus the quick-input overlay. Called by the shortcut handler.
pub fn show_quick(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        // Position to the lower-middle default only the first time it's shown this
        // session; afterwards keep wherever it sits (including any user drag).
        if !POSITIONED.swap(true, Ordering::Relaxed) {
            position_lower_middle(&w);
        }
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

/// Resize the quick-input overlay to fit its content height (width is fixed).
/// Clamped so the overlay never collapses or grows past a sensible maximum;
/// the webview measures its content and calls this as the panel grows/shrinks.
#[tauri::command]
pub fn set_quick_height(app: AppHandle, height: f64) {
    // WIDTH must match the "quick" window width declared in tauri.conf.json.
    const WIDTH: f64 = 640.0;
    const MIN: f64 = 120.0;
    const MAX: f64 = 480.0;
    if let Some(w) = app.get_webview_window("quick") {
        let new_h = height.clamp(MIN, MAX);
        // Grow/shrink from a fixed bottom edge (the lower-middle default, or
        // wherever the user dragged it) so the panel expands upward and never
        // runs off the bottom of the screen as it gets taller.
        if let (Ok(scale), Ok(pos), Ok(size)) =
            (w.scale_factor(), w.outer_position(), w.outer_size())
        {
            let p = pos.to_logical::<f64>(scale);
            let s = size.to_logical::<f64>(scale);
            let bottom = p.y + s.height;
            let _ = w.set_position(LogicalPosition::new(p.x, bottom - new_h));
        }
        let _ = w.set_size(LogicalSize::new(WIDTH, new_h));
    }
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
    std::env::temp_dir().join(format!("snak-shot-{nanos}.png"))
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

/// Actionable message surfaced when macOS Screen Recording permission is denied.
const PERMISSION_MSG: &str = "Screenshot failed. Grant Screen Recording to snak in \
    System Settings → Privacy & Security → Screen Recording, then quit and reopen the app.";

#[cfg(target_os = "macos")]
fn capture_interactive() -> Result<Option<String>, String> {
    let path = temp_png_path();
    // Use -x to silence the shutter sound while the overlay is hidden.
    let out = std::process::Command::new("screencapture")
        .args(["-x", "-t", "png", "-i"])
        .arg(&path)
        .output()
        .map_err(|e| format!("failed to run screencapture: {e}"))?;

    let success = out.status.success();
    let stderr = String::from_utf8_lossy(&out.stderr);
    let file_absent_or_empty =
        !path.exists() || path.metadata().map(|m| m.len() == 0).unwrap_or(true);

    // Always clean up temp file on error paths.
    if file_absent_or_empty {
        let _ = std::fs::remove_file(&path);
    }

    if success && file_absent_or_empty && stderr.trim().is_empty() {
        // Genuine user cancel: screencapture exited cleanly but wrote nothing.
        return Ok(None);
    }

    if !success || file_absent_or_empty {
        // Non-zero exit or no output file — check for known permission / rect errors.
        let stderr_lower = stderr.to_ascii_lowercase();
        if stderr_lower.contains("could not create image from rect")
            || stderr_lower.contains("not authorized")
            || stderr_lower.contains("permission")
        {
            return Err(PERMISSION_MSG.to_string());
        }
        // Other failure — surface trimmed stderr verbatim, or a generic fallback.
        let msg = stderr.trim().to_string();
        return Err(if msg.is_empty() {
            format!("screencapture failed (exit {})", out.status)
        } else {
            msg
        });
    }

    read_and_encode(&path)
}

#[cfg(target_os = "linux")]
fn capture_interactive() -> Result<Option<String>, String> {
    // KDE's Spectacle: region (-r), background (-b), no-notify (-n), output (-o).
    // Spectacle's file-or-nothing behavior already maps correctly through read_and_encode:
    // no file → clean Ok(None) cancel; file present → encode.
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
