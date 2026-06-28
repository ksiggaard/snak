//! Global quick-input overlay: a frameless always-on-top window summoned by a
//! global shortcut. It captures text + images and hands them to the main window
//! (which owns the chat/DB logic) via the `quick-submit` event.

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, WebviewWindow};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Fraction of the monitor height at which the overlay's *bottom* edge sits by
/// default ("lower-middle"). The panel grows upward from this anchor.
const BOTTOM_ANCHOR_FRAC: f64 = 0.80;

/// The monitor under the mouse cursor — so on a multi-monitor setup the overlay
/// appears on whichever screen the user is currently working on. Falls back to
/// the overlay's current monitor when the cursor/monitor lookup is unavailable.
fn monitor_under_cursor(w: &WebviewWindow) -> Option<Monitor> {
    if let Ok(pos) = w.cursor_position() {
        if let Ok(Some(m)) = w.monitor_from_point(pos.x, pos.y) {
            return Some(m);
        }
    }
    w.current_monitor().ok().flatten()
}

/// Place the overlay horizontally centered with its bottom edge at
/// `BOTTOM_ANCHOR_FRAC` of the height of the monitor under the cursor. Falls
/// back to the OS center if monitor info is unavailable.
fn position_lower_middle(w: &WebviewWindow) {
    let Some(monitor) = monitor_under_cursor(w) else {
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
        // Reposition on every show so the overlay appears on the monitor under
        // the mouse cursor (multi-monitor) at the lower-middle default, rather
        // than staying on whichever screen it was last shown.
        position_lower_middle(&w);
        let _ = w.show();
        let _ = w.set_focus();
        // T31: ask the main window for the recent-thread list. The overlay never
        // touches the DB, so main answers from its in-memory threads store by
        // emitting `quick-recents` (id + title of the most recent threads) to
        // the `quick` window.
        let _ = app.emit_to("main", "quick-recents-request", ());
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
    gs.register(accelerator.as_str()).map_err(|e| e.to_string())?;
    // Keep the tray "Quick Chat" item's shown shortcut in sync with the live one.
    if let Some(item) = app.try_state::<crate::QuickChatItem>() {
        let _ = item.0.set_text(format!("Quick Chat ({accelerator})"));
    }
    Ok(())
}

/// Interactive region screenshot, returned as base64. `None` if the user
/// cancelled. The *invoking* window (quick overlay or main chat) is hidden
/// during capture so it isn't in the shot, then restored.
#[tauri::command]
pub async fn take_screenshot(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    let is_quick = window.label() == "quick";
    let was_visible = window.is_visible().unwrap_or(false);
    if was_visible {
        if is_quick {
            hide_quick_inner(&app);
        } else {
            let _ = window.hide();
        }
        // Give the compositor a beat to unmap the window before the capture
        // tool freezes the screen.
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }

    let result = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| format!("screenshot task failed: {e}"))??;

    if was_visible {
        if is_quick {
            show_quick(&app);
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    Ok(result)
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

#[cfg(target_os = "macos")]
fn capture_interactive() -> Result<Option<String>, String> {
    const PERMISSION_MSG: &str = "Screenshot failed. Grant Screen Recording to snak in \
        System Settings → Privacy & Security → Screen Recording, then quit and reopen the app.";
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
