mod commands;
mod plugins;
mod providers;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Whether closing the main window hides it to the tray instead of quitting.
/// Defaults to ON; the frontend syncs the persisted `close_to_tray` setting via
/// `set_close_to_tray` after startup. Tray "Quit" bypasses this and exits.
struct CloseToTray(AtomicBool);

impl Default for CloseToTray {
    fn default() -> Self {
        CloseToTray(AtomicBool::new(true))
    }
}

/// Persisted by the frontend in the `settings` table; mirrored into managed
/// state here so the (Rust-side) window-close handler can read it synchronously.
#[tauri::command]
fn set_close_to_tray(state: State<'_, CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

/// Show + unminimize + focus the main window (mirrors `quick::focus_main`).
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Toggle main window visibility: hide if visible, otherwise show + focus.
fn toggle_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

/// Default global shortcut (Option+Space on macOS). Overridable at runtime via
/// `set_global_shortcut`; the frontend re-applies the persisted value on start.
const DEFAULT_SHORTCUT: &str = "Alt+Space";

/// SQLite database URL, shared by the migration runner (backend) and
/// `Database.load(...)` (frontend). Keep these in sync.
const DB_URL: &str = "sqlite:kde-llm.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init schema: threads, messages, attachments, settings",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "projects: projects, project_files, threads.project_id",
            sql: include_str!("../migrations/002_projects.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "usage: per-response token usage (provider, model, tokens)",
            sql: include_str!("../migrations/003_usage.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "user_memory: persistent memory-about-the-user for the system context",
            sql: include_str!("../migrations/005_user_memory.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CloseToTray::default())
        .manage(commands::chat::CancelFlag::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        commands::quick::show_quick(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Register the default shortcut; the frontend overrides it with the
            // user's saved accelerator (if any) once it loads.
            let _ = app.global_shortcut().register(DEFAULT_SHORTCUT);

            // System tray: icon + menu (Show/Hide, Quit) and click-to-toggle.
            let show_hide = MenuItem::with_id(app, "show_hide", "Show / Hide", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_hide, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show_hide" => toggle_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray: when enabled (default), closing `main` hides it so
            // the app keeps running for the global shortcut. Tray "Quit" calls
            // `app.exit(0)` directly and is unaffected.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let state = window.state::<CloseToTray>();
                    if state.0.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::keys::set_api_key,
            commands::keys::has_api_key,
            commands::keys::delete_api_key,
            commands::chat::chat_stream,
            commands::chat::cancel_stream,
            commands::quick::submit_quick,
            commands::quick::hide_quick,
            commands::quick::set_global_shortcut,
            commands::quick::take_screenshot,
            commands::terminal::open_in_terminal,
            commands::themes::list_themes,
            commands::themes::themes_directory,
            set_close_to_tray,
            plugins::list_plugins,
            plugins::set_plugin_enabled,
            plugins::uninstall_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
