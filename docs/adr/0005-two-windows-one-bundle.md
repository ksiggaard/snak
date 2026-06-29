# ADR-0005: Two windows, one bundle

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-28

## Context and Problem Statement

snak is both a main chat application *and* a global-shortcut quick-input overlay — a frameless, transparent, always-on-top capture box summoned with `Alt+Space`. The overlay could be shipped as a separate build/binary, but that would duplicate the React/Vite toolchain, the provider list, and the store wiring for one small surface. We need to decide how the overlay is packaged and how it hands work to the main app.

## Decision Drivers

* Avoid duplicating the toolchain, provider registry, and store for a small surface
* Reuse the main streaming path rather than reimplementing it
* Preserve the database-ownership invariant ([ADR-0003](./0003-frontend-owns-the-database.md))

## Considered Options

* **Option 1:** One bundle, two windows — route by window label at runtime
* **Option 2:** A separate build/binary for the overlay

## Decision Outcome

Chosen option: **Option 1 — one bundle, two windows**, because it reuses one toolchain, one provider registry, and one store while keeping the overlay a thin capture surface. `main.tsx` routes by `getCurrentWindow().label`: `quick` → the `QuickInput` overlay, anything else → the full `App`. The `quick` window is defined in `tauri.conf.json` (frameless/transparent/always-on-top/hidden-by-default; transparency needs `app.macOSPrivateApi` + the `macos-private-api` feature). The overlay **never touches the DB** — on submit it calls `submit_quick`, which emits a `quick-submit` event to `main`; `App` listens and runs the normal `startNewChat()` + `send()` store path.

### Consequences

* **Positive:** One toolchain, one provider registry, one store — the overlay reuses the main streaming path instead of reimplementing it. The DB-ownership invariant ([ADR-0003](./0003-frontend-owns-the-database.md)) holds: only `main` writes; the overlay just hands off text + images via an event. The global shortcut is registered in Rust (`tauri-plugin-global-shortcut`) so it fires even when the app is unfocused; the handler calls `show_quick`.
* **Negative:** Window-label routing in `main.tsx` is load-bearing — every new window must be routed there and listed in `capabilities/default.json`, or it silently renders the wrong surface. The two windows also share one bundle, so overlay-only concerns ship in the main app's code.

## Pros and Cons of the Options

### Option 1 — One bundle, two windows

* **Good:** No duplicated toolchain, provider registry, or store.
* **Good:** Overlay reuses the main `send()`/streaming path and respects [ADR-0003](./0003-frontend-owns-the-database.md).
* **Good:** A single build artifact to package and ship.
* **Bad:** Label routing is load-bearing and easy to forget when adding a window; all window code ships together.

### Option 2 — Separate build/binary

* **Good:** Clean isolation between overlay and main app.
* **Good:** Each surface ships only its own code.
* **Bad:** Duplicates the React/Vite toolchain, provider list, and store wiring for one small surface.
* **Bad:** Cross-process hand-off and shared logic become harder to keep in sync.
