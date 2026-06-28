//! Desktop "chat is done" notification.
//!
//! Fired by the frontend when a reply finishes streaming. We show an OS
//! notification only when the main window isn't focused, and on a click we
//! raise the window and emit `notify-activate` so the frontend can open the
//! originating thread (mirrors the `quick-submit` round-trip in `quick.rs`).
//!
//! Uses `notify-rust` directly rather than `tauri-plugin-notification` because
//! the official plugin has no desktop click/action support (mobile-only).

use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub fn notify_chat_done(app: AppHandle, thread_id: String, title: String, body: String) {
    // Skip entirely when the main window currently has OS focus — the user is
    // already looking at snak, so a notification would just be noise.
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if focused {
        return;
    }

    // `wait_for_action` BLOCKS the calling thread until the user clicks or
    // dismisses the notification, so run it on a short-lived OS thread (one per
    // notification). On the "default" action (banner/body click) we raise main
    // and hand the thread id back to the frontend.
    std::thread::spawn(move || {
        let handle = match notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .show()
        {
            Ok(h) => h,
            Err(_) => return,
        };
        handle.wait_for_action(|action| {
            if action == "default" {
                let _ = app.emit_to("main", "notify-activate", &thread_id);
                if let Some(w) = app.get_webview_window("main") {
                    // Same trio as quick::focus_main_inner / lib::show_main.
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
    });
}
