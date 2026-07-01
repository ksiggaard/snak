# Quick-input overlay, global shortcut & screenshots

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

- **Two windows, one bundle.** `main.tsx` routes by `getCurrentWindow().label`: `quick` → `QuickInput` overlay, anything else → `App`. The `quick` window (defined in `tauri.conf.json`) is frameless/transparent/always-on-top/hidden-by-default; transparency needs `app.macOSPrivateApi` + the `macos-private-api` Tauri feature, and `html.overlay` CSS in `index.css` makes the body transparent.
- **Global shortcut** (`tauri-plugin-global-shortcut`, registered in Rust `lib.rs`): default `Alt+Space` (Option+Space). The Rust handler calls `show_quick`, so it fires even when the app is unfocused. Customizable via `ShortcutSetting` → `set_global_shortcut` command, persisted in `settings.global_shortcut`; `App` re-applies the saved value on startup.
- **Overlay → main flow:** the overlay never touches the DB. On submit it calls `submit_quick` (`commands/quick.rs`), which emits a `quick-submit` event to the main window, focuses main, and hides the overlay. `App` listens for `quick-submit` and runs `startNewChat()` + `send(text, images)` — reusing the normal store/streaming path, so a new thread is created with the draft provider/model.
- **Screenshots:** `take_screenshot` command runs the OS interactive region tool (`screencapture -i` on macOS, `spectacle -r` on KDE), returns base64 PNG (or null if cancelled), hiding the overlay during capture. macOS may require **Screen Recording** permission. Frontend wrappers for all of this live in `src/lib/quick.ts`.
- Commands here are desktop-only (the plugin/crate are gated to non-mobile in `Cargo.toml`); both windows are listed in `capabilities/default.json` with `global-shortcut:default`.
