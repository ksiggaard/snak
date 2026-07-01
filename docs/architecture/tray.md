# System tray

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

- **Tray icon + menu** are built in Rust (`src-tauri/src/lib.rs`). The menu has **Quick Chat** (opens the overlay, mirrors the global shortcut and shows its live accelerator via the managed `QuickChatItem`), **Show / Hide** (toggles main-window visibility), a **Tray Icon** light/dark submenu (radio, persisted, managed by `TrayIconChecks`), and **Quit** (`app.exit(0)` — bypasses close-to-tray).
- **Left-click the tray icon** toggles the main window (show if hidden, hide if visible).
- **Close-to-tray:** closing the main window hides it instead of quitting when `close_to_tray` is on (the default). State is a managed `CloseToTray(AtomicBool)` synced from the frontend's persisted setting via the `set_close_to_tray` command.
