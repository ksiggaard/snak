# 0005. Two windows, one bundle

- **Status:** Accepted
- **Date:** 2026-06-28

## Context

snak is a main chat app *and* a global-shortcut quick-input overlay (a frameless,
transparent, always-on-top capture box summoned with `Alt+Space`). The overlay could be a
separate build/binary, but that means duplicating the React/Vite toolchain, the provider
list, and the store wiring for one small surface.

## Decision

**One bundle, two windows.** `main.tsx` routes by `getCurrentWindow().label`: `quick` →
the `QuickInput` overlay, anything else → the full `App`. The `quick` window is defined in
`tauri.conf.json` (frameless/transparent/always-on-top/hidden-by-default; transparency needs
`app.macOSPrivateApi` + the `macos-private-api` feature). The overlay **never touches the
DB** — on submit it calls `submit_quick`, which emits a `quick-submit` event to `main`; `App`
listens and runs the normal `startNewChat()` + `send()` store path.

## Consequences

- One toolchain, one provider registry, one store — the overlay reuses the main streaming
  path instead of reimplementing it.
- The DB-ownership invariant ([ADR 0003](./0003-frontend-owns-the-database.md)) holds: only
  `main` writes; the overlay just hands off text + images via an event.
- Window-label routing is load-bearing — new windows must be routed in `main.tsx` and listed
  in `capabilities/default.json`.
- The global shortcut is registered in Rust (`tauri-plugin-global-shortcut`) so it fires when
  the app is unfocused; the handler calls `show_quick`.
