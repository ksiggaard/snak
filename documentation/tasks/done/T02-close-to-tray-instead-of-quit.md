# T2 — Close-to-tray instead of quit

- **Status:** done
- **Owner:** Agent A
- **Priority:** P1
- **Layer:** Rust (window event handler) + Settings UI toggle (frontend)
- **Depends on:** T1

Closing the `main` window should hide it to the tray rather than terminate the app, so it
keeps running for the global shortcut. Quit must remain reachable from the tray menu (T1).

**Acceptance criteria:**
- Intercept the main window close-requested event; prevent-close + hide instead.
- A setting controls this ("Close to tray" on/off), persisted in the `settings` table
  alike to `global_shortcut` / `last_thread_id`. Default: on.
- Quitting via the tray menu (T1) still fully exits.

**Notes:**
- 2026-06-09 (Agent A): Mechanism — Tauri managed state `CloseToTray(AtomicBool)`
  defaulting to `true`, read synchronously by an `on_window_event` `CloseRequested`
  handler for `main` (`api.prevent_close()` + `window.hide()` when enabled). A
  `set_close_to_tray(enabled)` command (registered in `lib.rs`, appended to the handler
  list) lets the frontend push the value; persistence is in the `settings` table
  (`close_to_tray` = "1"/"0", absent = ON). New `CloseToTray.tsx` settings card
  (Button toggle — no shadcn Switch in the tree) mounted in `App.tsx`, which also syncs
  the saved value into managed state on startup. Tray Quit calls `app.exit(0)` directly,
  bypassing the handler. Verified via cargo build/clippy/fmt + npm build/lint.
