mod commands;
mod providers;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Default global shortcut (Option+Space on macOS). Overridable at runtime via
/// `set_global_shortcut`; the frontend re-applies the persisted value on start.
const DEFAULT_SHORTCUT: &str = "Alt+Space";

/// SQLite database URL, shared by the migration runner (backend) and
/// `Database.load(...)` (frontend). Keep these in sync.
const DB_URL: &str = "sqlite:kde-llm.db";

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init schema: threads, messages, attachments, settings",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
