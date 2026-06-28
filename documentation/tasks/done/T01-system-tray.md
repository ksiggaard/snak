# T1 — System tray (minimize to tray)

- **Status:** done
- **Owner:** Agent A
- **Priority:** P0 (headline gap vs. the intended product; no tray code exists today)
- **Layer:** Rust (tray registration) + small frontend touch for window-close behavior
- **Depends on:** —

The intended product "runs minimized to the system tray, summonable via a global
shortcut." There is currently **no tray code anywhere**. Add a system tray icon with a
menu and click-to-toggle behavior for the `main` window.

**Acceptance criteria:**
- Tray icon appears on app start (use existing `src-tauri/icons/`).
- Tray menu with at least: **Show / Hide window** and **Quit**.
- Left-click (or platform-appropriate click) toggles the `main` window's visibility +
  focus. Reuse/extend the show-window helper pattern in `commands/quick.rs`.
- Enable the `tray-icon` feature on the `tauri` crate in `Cargo.toml`; build the tray in
  the `setup` hook in `src-tauri/src/lib.rs`.
- Add any required tray permissions to `src-tauri/capabilities/default.json`.

**Notes:**
- Tray APIs differ slightly across platforms; primary target is KDE/Linux but it should
  build on macOS too (dev machine). Note any platform gating used.
- 2026-06-09 (Agent A): Added `tray-icon` feature to `tauri` in `Cargo.toml`. Tray built
  in the `setup` hook in `lib.rs` (`TrayIconBuilder`, icon from `default_window_icon`),
  menu with Show/Hide (`toggle_main`) + Quit (`app.exit(0)`); left-click-up toggles the
  `main` window (no platform gating needed — tray-icon is cross-platform). Added
  `core:tray:default` + `core:menu:default` to `capabilities/default.json`. cargo
  build/clippy/fmt clean; manual tray click testing deferred (macOS dev box).
