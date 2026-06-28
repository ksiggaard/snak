mod commands;
mod mcp;
mod menu;
mod plugins;
mod providers;
mod research;
mod skills;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, Submenu};
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

/// The tray "Quick Chat" menu item, held in managed state so
/// `set_global_shortcut` can keep its shown accelerator in sync with the live
/// global shortcut (the tray is built in Rust before the frontend applies the
/// user's saved shortcut, and Rust doesn't read the settings DB).
pub(crate) struct QuickChatItem(pub(crate) MenuItem<tauri::Wry>);

/// Which tray icon to show; picked from the tray menu, persisted in app-data.
#[derive(Clone, Copy, PartialEq, Eq)]
enum TrayVariant {
    Light,
    Dark,
}

impl TrayVariant {
    fn as_str(self) -> &'static str {
        match self {
            TrayVariant::Light => "light",
            TrayVariant::Dark => "dark",
        }
    }

    /// Anything unrecognized falls back to Dark (the default).
    fn parse(s: &str) -> TrayVariant {
        match s.trim() {
            "light" => TrayVariant::Light,
            _ => TrayVariant::Dark,
        }
    }

    /// The embedded glyph for this variant (compiled in; nothing to ship).
    fn image(self) -> tauri::image::Image<'static> {
        match self {
            TrayVariant::Light => tauri::include_image!("../graphics/sys_tray_light.png"),
            TrayVariant::Dark => tauri::include_image!("../graphics/sys_tray_dark.png"),
        }
    }
}

/// The tray's two check items, held so the menu handler can flip their marks.
struct TrayIconChecks {
    light: CheckMenuItem<tauri::Wry>,
    dark: CheckMenuItem<tauri::Wry>,
}

fn tray_icon_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("tray_icon"))
}

fn load_tray_variant(app: &tauri::AppHandle) -> TrayVariant {
    tray_icon_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| TrayVariant::parse(&s))
        .unwrap_or(TrayVariant::Dark)
}

/// Apply a tray-icon choice: swap the icon, update the check marks, persist it.
fn set_tray_variant(app: &tauri::AppHandle, v: TrayVariant) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(v.image()));
    }
    if let Some(checks) = app.try_state::<TrayIconChecks>() {
        let _ = checks.light.set_checked(v == TrayVariant::Light);
        let _ = checks.dark.set_checked(v == TrayVariant::Dark);
    }
    if let Some(path) = tray_icon_file(app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, v.as_str());
    }
}

/// Restart the app. Used after a runtime plugin is installed/uninstalled so the
/// frontend plugin loader re-runs and the change takes effect. Never returns.
#[tauri::command]
fn restart(app: tauri::AppHandle) {
    app.restart();
}

/// Grant the webview microphone access so the audio plugin's in-webview recorder
/// (`getUserMedia`) works. WebKitGTK denies media-stream requests by default and
/// never prompts, so we enable the media-stream setting and auto-allow permission
/// requests for the main window. On macOS/Windows the system webview prompts the
/// user natively, so this is a no-op there.
#[cfg(target_os = "linux")]
fn grant_microphone_access(window: &tauri::WebviewWindow) {
    use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
    let _ = window.with_webview(|webview| {
        let wv = webview.inner();
        if let Some(settings) = WebViewExt::settings(&wv) {
            settings.set_enable_media_stream(true);
        }
        wv.connect_permission_request(|_wv, request| {
            // Local desktop app: the only media-capable surface is our own UI,
            // so granting capture requests is safe and avoids a dead mic button.
            request.allow();
            true
        });
    });
}

#[cfg(not(target_os = "linux"))]
fn grant_microphone_access(_window: &tauri::WebviewWindow) {}

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
const DB_URL: &str = "sqlite:snak.db";

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
            version: 4,
            description: "search: FTS5 index over thread titles + message content",
            sql: include_str!("../migrations/004_search_fts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "user_memory: persistent memory-about-the-user for the system context",
            sql: include_str!("../migrations/005_user_memory.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "models: configurable per-provider model list (seeded)",
            sql: include_str!("../migrations/006_models.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "favorites: per-thread favorite flag for the sidebar Favorites group",
            sql: include_str!("../migrations/007_favorites.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "message duration: per-assistant-reply generation time in ms",
            sql: include_str!("../migrations/008_message_duration.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description:
                "compaction: messages.kind ('normal' | 'summary') marking compaction points",
            sql: include_str!("../migrations/009_compaction.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "incognito: threads.ephemeral flag for session-only chats (T29)",
            sql: include_str!("../migrations/010_incognito.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "chats as tabs: threads.archived flag (close-to-archive)",
            sql: include_str!("../migrations/011_archive.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "document attachments: attachments.filename for kind='document' (T39)",
            sql: include_str!("../migrations/012_document_attachments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "bots: bots, bot_memory, threads.bot_id (T38 personas)",
            sql: include_str!("../migrations/013_bots.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "bots: tagline subtitle (T38 follow-up)",
            sql: include_str!("../migrations/014_bot_tagline.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "personas: profile fields, self-managed memory + mood (T40)",
            sql: include_str!("../migrations/015_personas.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "mentions: messages.bot_id persona attribution (T43)",
            sql: include_str!("../migrations/016_message_bot.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "response variations: messages.variant_group + variant_selected (T54)",
            sql: include_str!("../migrations/017_message_variants.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "per-project quick actions: projects.quick_actions",
            sql: include_str!("../migrations/018_quick_actions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "per-persona conversation starters: bots.starters",
            sql: include_str!("../migrations/019_bot_starters.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "deep research mode toggle: threads.deep_research",
            sql: include_str!("../migrations/020_deep_research.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "artifacts: LLM-generated multi-file web apps",
            sql: include_str!("../migrations/021_artifacts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "workspaces: rename projects→workspaces, project_files→workspace_files, threads.project_id→workspace_id",
            sql: include_str!("../migrations/022_workspaces.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "workspace_files.source_url: nullable provenance URL for URL-ingested files (T59)",
            sql: include_str!("../migrations/023_workspace_file_source_url.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "threads.workspace_files_excluded: per-chat excluded workspace-file ids (T61)",
            sql: include_str!("../migrations/024_workspace_files_excluded.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "workspace_memory: per-workspace memory table + workspaces.memory_enabled toggle (T62)",
            sql: include_str!("../migrations/025_workspace_memory.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "workspace profile and cover images (T63)",
            sql: include_str!("../migrations/026_workspace_images.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "model notes: free-text description per model",
            sql: include_str!("../migrations/027_model_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "per-message model tracking + planner-active thread flag",
            sql: include_str!("../migrations/028_message_model.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "workspace image reposition (profile x/y/zoom, cover x/y)",
            sql: include_str!("../migrations/029_image_position.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "library_artifacts: saved independent artifact copies",
            sql: include_str!("../migrations/030_library_artifacts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "plugin_storage: scoped key-value store for runtime plugins",
            sql: include_str!("../migrations/031_plugin_storage.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "output_type: per-thread response-style selection",
            sql: include_str!("../migrations/032_output_type.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NVIDIA's proprietary driver does not implement Mesa's GBM API, so
    // WebKitGTKDMABuf buffer allocation fails with "Failed to create GBM
    // buffer". Disable DMABuf when the nvidia kernel module is present
    // (harmless false-positive on hybrid laptops — the Intel/AMD side's
    // Mesa GBM still works, but the net effect is just lower FPS, not a
    // crash). Everyone else (Mesa, Windows, macOS) gets GPU compositing.
    // Respect an explicit env-var override in either direction.
    if cfg!(target_os = "linux")
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/sys/module/nvidia").exists()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .manage(CloseToTray::default())
        .manage(commands::chat::CancelFlag::default())
        .manage(commands::chat::PendingApprovals::default())
        .manage(commands::keys::KeyCache::default())
        .manage(mcp::session::McpSessions::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            // Seed bundled runtime plugins into app-data (idempotent, if-absent)
            // so the loader discovers them like any installed plugin.
            if let Err(e) = plugins::runtime::seed_bundled_plugins(app.handle()) {
                eprintln!("[plugins] seeding bundled plugins failed: {e}");
            }

            // Register the default shortcut; the frontend overrides it with the
            // user's saved accelerator (if any) once it loads.
            let _ = app.global_shortcut().register(DEFAULT_SHORTCUT);

            // Remove the OS title bar on all platforms so the app renders its
            // own compact one (the default). If the user saved the "native"
            // title-bar preference, the frontend re-enables decorations on
            // startup (see the effect in App.tsx).
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_decorations(false);
                grant_microphone_access(&w);
            }

            // Native application menu (macOS menu bar / Linux global menu).
            menu::install(app)?;

            // Reap idle external-stdio MCP sessions (e.g. a lingering headless
            // browser) ~every minute; 10-minute idle window.
            {
                let sessions = app.state::<mcp::session::McpSessions>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                        sessions
                            .reap_idle(std::time::Duration::from_secs(600))
                            .await;
                    }
                });
            }

            // System tray: icon + menu (Quick Chat, Show/Hide, Quit) and
            // click-to-toggle. "Quick Chat" opens the overlay (same path as the
            // global shortcut) and shows the current shortcut next to its label.
            let quick_chat = MenuItem::with_id(
                app,
                "quick_chat",
                format!("Quick Chat ({DEFAULT_SHORTCUT})"),
                true,
                None::<&str>,
            )?;
            let show_hide = MenuItem::with_id(app, "show_hide", "Show / Hide", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            // "Tray Icon" submenu: pick the light or dark glyph (persisted).
            let tray_variant = load_tray_variant(app.handle());
            let icon_light = CheckMenuItem::with_id(
                app,
                "tray_light",
                "Light",
                true,
                tray_variant == TrayVariant::Light,
                None::<&str>,
            )?;
            let icon_dark = CheckMenuItem::with_id(
                app,
                "tray_dark",
                "Dark",
                true,
                tray_variant == TrayVariant::Dark,
                None::<&str>,
            )?;
            let icon_menu = Submenu::with_items(app, "Tray Icon", true, &[&icon_light, &icon_dark])?;

            let menu = Menu::with_items(app, &[&quick_chat, &show_hide, &icon_menu, &quit])?;
            // Held so `set_global_shortcut` can update the shown shortcut.
            app.manage(QuickChatItem(quick_chat));
            // Held so the menu handler can flip the icon check marks.
            app.manage(TrayIconChecks {
                light: icon_light,
                dark: icon_dark,
            });

            // The tray icon is embedded at compile time (`include_image!`) so it's
            // always available on Linux (default_window_icon() can return None in
            // dev mode there). `with_id("main")` lets the menu handler fetch the
            // tray via `tray_by_id` to swap its icon.
            TrayIconBuilder::with_id("main")
                .icon(tray_variant.image())
                .icon_as_template(false)
                .tooltip("snak")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quick_chat" => commands::quick::show_quick(app),
                    "show_hide" => toggle_main(app),
                    "tray_light" => set_tray_variant(app, TrayVariant::Light),
                    "tray_dark" => set_tray_variant(app, TrayVariant::Dark),
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
                })
                .build(app)?;

            Ok(())
        })
        .on_menu_event(menu::on_menu_event)
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
            commands::chat::approve_tool_call,
            commands::quick::submit_quick,
            commands::quick::hide_quick,
            commands::quick::set_global_shortcut,
            commands::quick::take_screenshot,
            commands::quick::set_quick_height,
            commands::terminal::open_in_terminal,
            commands::documents::extract_document_text,
            commands::url::fetch_url_as_markdown,
            commands::url::fetch_youtube_transcript,
            commands::files::save_image,
            commands::artifacts::export_artifact_zip,
            commands::artifacts::open_artifact_in_browser,
            commands::languages::list_languages,
            commands::languages::languages_directory,
            commands::media::media_playback_available,
            commands::notify::notify_chat_done,
            commands::audio::audio_status,
            commands::audio::tts_synthesize,
            commands::audio::stt_transcribe,
            commands::connectivity::connectivity_probe,
            commands::ollama::ollama_status,
            commands::ollama::ollama_list_models,
            commands::ollama::ollama_ps,
            commands::ollama::ollama_start,
            commands::ollama::ollama_unload,
            commands::routing::route_directions,
            commands::geocode::geocode,
            set_close_to_tray,
            restart,
            menu::set_menu_visible,
            menu::quit_app,
            plugins::list_plugins,
            plugins::set_plugin_enabled,
            plugins::uninstall_plugin,
            plugins::runtime::read_plugin_entry,
            plugins::runtime::import_plugin,
            plugins::runtime::pick_plugin_zip,
            skills::list_skills,
            skills::read_skill,
            skills::save_skill,
            skills::delete_skill,
            skills::set_skill_enabled,
            skills::import_skills,
            skills::pick_skills_dir,
            mcp::mcp_list_tools,
            mcp::mcp_close_thread_sessions,
            mcp::mcp_close_server_sessions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let sessions = app_handle
                    .state::<mcp::session::McpSessions>()
                    .inner()
                    .clone();
                tauri::async_runtime::block_on(sessions.close_all());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::TrayVariant;

    #[test]
    fn tray_variant_parse_defaults_to_dark() {
        assert_eq!(TrayVariant::parse("light").as_str(), "light");
        assert_eq!(TrayVariant::parse("dark").as_str(), "dark");
        assert_eq!(TrayVariant::parse(" light ").as_str(), "light"); // trimmed
        assert_eq!(TrayVariant::parse("").as_str(), "dark"); // empty → default
        assert_eq!(TrayVariant::parse("nonsense").as_str(), "dark"); // unknown → default
    }
}
