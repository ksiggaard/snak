//! Native application menu: the macOS menu bar, and on Linux/Windows a GTK
//! menubar on the main window. On KDE the global-menu applet picks the Linux
//! menubar up over DBus (via the distro's `appmenu-gtk-module`) and hides it
//! locally, so it behaves like a first-class native menu.
//!
//! Menu items carry no behavior here beyond surfacing the main window: each
//! selection emits an `app-menu` event with an action string, and `App.tsx`
//! maps actions onto the existing stores (new chat, search, settings, …).

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter};
// `Manager` is only needed for `get_webview_window`, which is called solely in
// the non-macOS branches below (macOS installs the menu app-wide instead).
#[cfg(not(target_os = "macos"))]
use tauri::Manager;

/// Event name the frontend listens on (see the menu effect in `App.tsx`).
const MENU_EVENT: &str = "app-menu";

/// Build the application menu and attach it: app-wide on macOS (one global
/// menu bar), main-window-only elsewhere (the quick overlay stays chromeless).
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let new_chat = MenuItem::with_id(app, "menu_new_chat", "New Chat", true, Some("CmdOrCtrl+N"))?;
    let settings = MenuItem::with_id(app, "menu_settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let search = MenuItem::with_id(
        app,
        "menu_search",
        "Search Chats…",
        true,
        Some("CmdOrCtrl+K"),
    )?;
    let toggle_sidebar = MenuItem::with_id(
        app,
        "menu_toggle_sidebar",
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+B"),
    )?;
    let usage = MenuItem::with_id(app, "menu_usage", "Usage", true, Some("CmdOrCtrl+U"))?;
    let focus_input = MenuItem::with_id(
        app,
        "menu_focus_input",
        "Focus Chat Input",
        true,
        Some("CmdOrCtrl+L"),
    )?;
    let zoom_in = MenuItem::with_id(app, "menu_zoom_in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?;
    let zoom_out = MenuItem::with_id(app, "menu_zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let zoom_reset = MenuItem::with_id(
        app,
        "menu_zoom_reset",
        "Reset Zoom",
        true,
        Some("CmdOrCtrl+0"),
    )?;

    // Quit: macOS gets the predefined item in the application menu (standard
    // Cmd+Q via NSApp.terminate); elsewhere a custom item handled in
    // `on_menu_event` with `app.exit(0)`, bypassing close-to-tray like the
    // tray's Quit does.
    #[cfg(not(target_os = "macos"))]
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_chat,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "menu_quit", "Quit", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[&new_chat, &PredefinedMenuItem::separator(app)?, &settings],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &search,
            &toggle_sidebar,
            &focus_input,
            &PredefinedMenuItem::separator(app)?,
            &usage,
            &PredefinedMenuItem::separator(app)?,
            &zoom_in,
            &zoom_out,
            &zoom_reset,
        ],
    )?;

    // macOS: the first submenu becomes the application menu, and an Edit menu
    // with the predefined roles is required for Cmd+C/V/X/A to reach the
    // webview. On Linux the webview handles those natively and muda's edit
    // roles are no-ops, so neither menu is included there.
    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = Submenu::with_items(
            app,
            "snak",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        let edit = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ],
        )?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &view])?
    };
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &view])?;

    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;
    #[cfg(not(target_os = "macos"))]
    if let Some(w) = app.get_webview_window("main") {
        w.set_menu(menu)?;
    }
    Ok(())
}

/// Show/hide the in-window menubar (Linux/Windows). The menu itself stays
/// installed either way — KDE's global menu (via `appmenu-gtk-module`) exports
/// the menu model over DBus independent of the widget's visibility. On macOS
/// the menu lives in the system menu bar and this is a no-op. Driven by the
/// "menu bar" Appearance setting (see the effect in `App.tsx`).
#[tauri::command]
pub fn set_menu_visible(app: AppHandle, visible: bool) {
    #[cfg(not(target_os = "macos"))]
    if let Some(w) = app.get_webview_window("main") {
        let _ = if visible {
            w.show_menu()
        } else {
            w.hide_menu()
        };
    }
    #[cfg(target_os = "macos")]
    let _ = (app, visible);
}

/// Exit the app, bypassing close-to-tray — the in-app menu bar's File → Quit
/// (the native menu's quit is handled in `on_menu_event` / predefined item).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// App-level menu-event dispatch. Tray menu clicks arrive here too (muda has
/// one event stream); their ids ("show_hide"/"quit") fall through the match
/// and stay handled by the tray's own `on_menu_event`.
pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == "menu_quit" {
        app.exit(0);
        return;
    }
    let action = match id {
        "menu_new_chat" => "new-chat",
        "menu_search" => "search",
        "menu_toggle_sidebar" => "toggle-sidebar",
        "menu_focus_input" => "focus-composer",
        "menu_settings" => "settings",
        "menu_usage" => "usage",
        "menu_zoom_in" => "zoom-in",
        "menu_zoom_out" => "zoom-out",
        "menu_zoom_reset" => "zoom-reset",
        _ => return,
    };
    // Menu actions target the main window; surface it first (on macOS the menu
    // bar stays reachable while the window is hidden to the tray).
    crate::show_main(app);
    let _ = app.emit_to("main", MENU_EVENT, action);
}
