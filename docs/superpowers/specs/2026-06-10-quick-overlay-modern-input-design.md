> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Modern quick-input overlay (ALT+Space)

**Date:** 2026-06-10
**Status:** Design — pending review
**Related:** `docs/superpowers/specs/2026-06-10-composer-restyle-design.md` (the chat composer this overlay is being brought in line with)

## Problem

The chat composer was just restyled (two-tier rounded panel, auto-growing textarea, borderless controls bar, compact model picker). The ALT+Space quick-input overlay (`src/components/QuickInput.tsx`, shown in the frameless `quick` window) still uses the old treatment: a fixed `rows={3}` textarea with no auto-grow, outlined buttons, and **no model selector** (it submits using whatever provider/model the main window's draft happens to be). We want the overlay to use the same modern input, including the model picker, and to feel like a Spotlight/Raycast field that grows to fit.

## Goals

1. The overlay's textarea auto-grows with content (then scrolls), matching the chat composer.
2. The overlay's buttons match the composer's borderless ghost style.
3. The overlay gains the model picker, and the **chosen model is used for the chat that the overlay starts**.
4. The overlay window **grows to fit** its content (up to a max), then the input scrolls — instead of being a fixed 260px box.

## Non-goals

- Slash commands or the canvas editor in the overlay (it stays a focused quick-capture).
- Live bidirectional model sync between windows. The overlay seeds its model from the persisted default; it does not mirror the main window's in-flight draft selection.
- Any change to the screenshot capture flow, the global-shortcut registration, or the `quick-submit` event mechanism.

## Current state (grounding)

- `quick` window: `tauri.conf.json` → `640 × 260`, `resizable: false`, `decorations: false`, `transparent: true`. `main.tsx` renders `<QuickInput/>` for label `quick`, `<App/>` otherwise. The quick window is created at startup and shown/hidden (its webview/JS persists across summons).
- `QuickInput.tsx`: local `text`/`images`/`busy`/`error` state; `<Textarea rows={3}>` (borderless via `border-0 shadow-none`); a controls bar with `ImagePicker` (Paperclip, `variant="outline"`), a screenshot `Camera` button (`variant="outline"`), a spacer, and a "Start chat" `Button`. It does **not** load any Zustand stores.
- Submit path: `submitQuick({ text, images })` → Rust `submit_quick(payload: serde_json::Value)` emits `quick-submit` to `main` (payload forwarded **opaquely**), focuses main, hides overlay. `App.tsx`'s `quick-submit` listener runs `startNewChat()` + `send(text, images)` using the main store's draft provider/model.
- Threads store (`src/store/threads.ts`): `init()` reads `DEFAULT_PROVIDER_KEY`/`DEFAULT_MODEL_KEY` settings → `resolveDefault(dp, dm)` → seeds `defaultProvider`/`defaultModel` + draft. `setProviderModel(provider, model)` sets the draft **synchronously** (`set({...})`) when there is no current thread. `startNewChat()` resets the draft to the defaults.
- Capabilities (`capabilities/default.json`): `windows: ["main","quick"]`; plugin permissions only (`core:default`, `sql:*`, …). App-defined `#[tauri::command]`s (e.g. `submit_quick`, `take_screenshot`, `has_api_key`) are callable from both windows without explicit capability entries (Tauri v2 gates plugin commands, not app commands). The webview is not granted `core:window:allow-set-size`.

## Design

### 1. Extract a shared, controlled `ModelChooser`

Create `src/components/chat/ModelChooser.tsx` — a **controlled, presentational** component holding everything the current `ModelPicker` does:

- Props: `{ provider: Provider; model: string; onSelect: (provider: Provider, model: string) => void; align?: "start" | "end"; className?: string }`.
- Internals (moved verbatim from the current `ModelPicker`): the async `keyed` API-key resolution, `buildModelOptions`, the provider-grouped `DropdownMenuGroup` list with the active model checked and inert entries disabled/"unavailable", the compact `label ⌄` ghost trigger, and the hover `Tooltip` showing `providerLabel · model`. It reads `useProviders`/`useModels`/`hasApiKey` internally (works in any window).
- The current selection's label comes from `currentModelLabel(providers, models, provider, model)` (unchanged).
- `onSelect` replaces the direct `setProviderModel` call.

`src/components/chat/ModelPicker.tsx` shrinks to a thin **store-bound wrapper**: it reads the current thread/draft provider+model from `useThreads` (as it does today) and renders `<ModelChooser provider={…} model={…} onSelect={setProviderModel} align="end" />`. **`Composer.tsx` and `ChatView.tsx` are unchanged** — they still render `<ModelPicker/>`.

Rationale: one chooser, two call sites (DRY). The overlay's selection stays local and travels in the submit payload, so the quick window needs no threads-store coupling.

### 2. Restyle `QuickInput`

- **Textarea:** drop `rows={3}`; keep it borderless (the panel is the visible box). Use `field-sizing-content` (base class) with `max-h-[320px] resize-none` so it auto-grows then scrolls — same mechanism and JS fallback option as the composer (`docs/.../composer-restyle-design.md` §2). Preserve the existing `onPaste` (image) and `onKeyDown` (Enter submits, Esc cancels) handlers and `ref`/autofocus.
- **Buttons:** `ImagePicker`'s Paperclip and the screenshot `Camera` button change `variant="outline"` → `variant="ghost"`.
- **Model picker:** add `<ModelChooser provider={sel.provider} model={sel.model} onSelect={(p,m) => setSel({provider:p, model:m})} />` into the controls bar, between the spacer and "Start chat": `[📎][📷] … [model ⌄] [Start chat]`. `sel` is local `useState`.
- **Initial selection:** seed `sel` from the persisted default — read `DEFAULT_PROVIDER_KEY`/`DEFAULT_MODEL_KEY` via `getSetting` and resolve with `resolveDefault` (export `resolveDefault` + the two key constants from `threads.ts`; they are currently module-private), falling back to the provider-registry default. Because the quick window's webview persists across summons, a selection made in the overlay sticks until app restart.
- **Store loading:** on mount, call `usePlugins.getState().load()` and `useModels.getState().load()` so `ModelChooser` has the real provider list + models (the quick window doesn't run `App`'s init). These are idempotent loads.

### 3. Grow-to-fit window

- Wrap the overlay panel in a `ref`; observe its rendered height with a `ResizeObserver`. On any height change (textarea growth, image previews appearing/clearing, the error line, the model row), compute the desired window height = `panel.offsetHeight + outerPadding` (the `p-2` margin around the panel, 8px × 2).
- Add a Rust command `set_quick_height(app, height: f64)` in `commands/quick.rs`: set the `quick` window inner size to `640 × height.clamp(MIN, MAX)` with `MIN = 160`, `MAX = 480` (`LogicalSize`). Native window sizing stays in Rust (architecture boundary; also avoids granting the webview `core:window:allow-set-size`). Register it in the `invoke_handler!` list; add a TS wrapper `setQuickHeight(h)` in `src/lib/quick.ts`.
- The textarea's `max-h-[320px]` is chosen so text-only growth scrolls at/below the window `MAX`. Known minor edge: many image previews **plus** maximal text can exceed `MAX`; the window clamps at `MAX` and the textarea still scrolls — acceptable for now (revisit only if it bites).
- On `submit()`/`cancel()`/`reset()`, call `setQuickHeight(MIN)` so the next summon opens compact. `show_quick` already re-centers on each show, so the smaller window is centered correctly.

### 4. Carry the chosen model into the new chat (no Rust payload change)

- `QuickPayload` (`src/lib/quick.ts`) gains `provider: Provider` and `model: string`. Because `submit_quick` forwards the payload as opaque `serde_json::Value`, **the Rust command is unchanged**.
- `QuickInput.submit()` includes `provider: sel.provider, model: sel.model` alongside `text`/`images`.
- The `quick-submit` handler in `App.tsx` applies the model to the new thread:
  ```ts
  startNewChat();
  useThreads.getState().setProviderModel(e.payload.provider, e.payload.model); // draft set synchronously
  void send(e.payload.text, e.payload.images);
  ```
  (`setProviderModel` with no current thread sets the draft synchronously; `send` then creates the thread on that provider/model. Falls back gracefully if the payload lacks the fields — guard with a presence check for forward/backward safety.)

## Files touched

- **Create** `src/components/chat/ModelChooser.tsx` — controlled chooser (logic moved from `ModelPicker`).
- **Modify** `src/components/chat/ModelPicker.tsx` — becomes a store-bound wrapper around `ModelChooser`.
- **Modify** `src/components/QuickInput.tsx` — restyle (ghost buttons, auto-grow textarea), add `ModelChooser` + local selection, seed from default, load `usePlugins`/`useModels` on mount, `ResizeObserver` → `setQuickHeight`, reset height on submit/cancel.
- **Modify** `src/lib/quick.ts` — extend `QuickPayload` with `provider`/`model`; add `setQuickHeight` wrapper.
- **Modify** `src/store/threads.ts` — export `resolveDefault`, `DEFAULT_PROVIDER_KEY`, `DEFAULT_MODEL_KEY` (no behavior change).
- **Modify** `src/App.tsx` — `quick-submit` handler applies `provider`/`model` before `send`.
- **Modify** `src-tauri/src/commands/quick.rs` — add `set_quick_height` command.
- **Modify** `src-tauri/src/lib.rs` — register `set_quick_height` in `invoke_handler!`.

No DB/migration changes. No new dependencies. No capability changes (app commands need none; window sizing is done Rust-side).

## Edge cases / behavior to preserve

- Screenshot capture (`take_screenshot`, overlay hidden during capture) and image attach/paste — unchanged.
- Enter submits, Shift+Enter newline, Esc dismisses — unchanged.
- Empty submit guard (`!trimmed && images.length === 0`) — unchanged.
- No providers enabled / no key for the seeded provider → `ModelChooser` shows the inert "unavailable" current entry exactly like the chat (no overlay-specific handling).
- Overlay re-summoned after a submit → compact (height reset) and re-focused (existing `onFocusChanged` focus logic).

## Testing

- **Unit:** `ModelChooser` extraction is behavior-preserving — existing `buildModelOptions`/`currentModelLabel` tests still cover the logic. If a pure helper is added for the default-seed or height clamp, add a focused test. (`set_quick_height`'s clamp could also get a tiny Rust unit test if cheap.)
- **Build/lint:** `npm run build`, `npm run lint`, `npx vitest run`; `cargo build` / `cargo clippy` for the Rust command.
- **Manual:** ALT+Space → compact overlay; type a long message → window grows to ~480 then textarea scrolls; previews/screenshot still work; pick a model → "Start chat" → main opens a new thread **on that model**; Esc → dismissed; re-summon → compact again.

## Out of scope (restated)

Slash commands/canvas in the overlay; bidirectional live model sync between windows; changes to screenshot/global-shortcut/event plumbing.
