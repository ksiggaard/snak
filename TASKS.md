# TASKS

Work queue for subagents implementing the remaining features of the KDE LLM app.
Read `CLAUDE.md` first for architecture, conventions, and the frontend/backend boundary.

## How to use this file

Each task is a section with a metadata block. To work a task:

1. **Claim it** — change `Status: todo` → `Status: in-progress` and set `Owner:` to your
   agent id/name. One owner per task; don't pick up a task another agent owns.
2. **Work it** — follow the task's acceptance criteria. Respect the layer boundary in
   `CLAUDE.md` (OS/DB/secrets → Rust; UI → React).
3. **Record progress** — add dated lines under `Notes:` as you go. If you hit a
   dependency or ambiguity you can't resolve, set `Status: blocked` and write why.
4. **Finish** — set `Status: done` when the acceptance criteria are met *and* verified
   (`npm run build`, `npm run lint`, `cargo clippy` as applicable; see
   `superpowers:verification-before-completion`). Don't claim done without running them.

**Status values:** `todo` · `in-progress` · `blocked` · `done`
**Owner:** agent id/name, or `—` when unclaimed.

Keep edits to this file surgical — only touch the task you own (plus adding a new task).

---

## Already implemented (reference, do not redo)

These are built in the current tree — listed so agents don't duplicate work:

- Tauri v2 + React 19 + TS + Vite scaffold; Tailwind v4 + shadcn/ui; light/dark/system theme.
- SQLite via `tauri-plugin-sql` with Rust-registered migration (`001_init.sql`); typed
  frontend helpers in `src/lib/db.ts`.
- API keys in the OS keychain (`keyring`); commands in `commands/keys.rs`.
- Four providers over raw `reqwest` (Anthropic, OpenAI, Mistral, Gemini) with the
  `Provider::stream` trait and SSE streaming; `chat_stream` command.
- Multi-thread chat with a Zustand store (`store/threads.ts`), lazy thread creation,
  last-active-thread restore, sidebar (rename/delete).
- Multimodal image input (`lib/image.ts`, `attachments` table).
- Quick-input overlay window, global shortcut (`Alt+Space`, customizable), screenshot
  capture (`screencapture -i` / `spectacle -r`).

---

## T1 — System tray (minimize to tray)

- **Status:** todo
- **Owner:** —
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

---

## T2 — Close-to-tray instead of quit

- **Status:** todo
- **Owner:** —
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

---

## T3 — Cancel / stop an in-progress generation

- **Status:** done
- **Owner:** Agent B
- **Priority:** P1
- **Layer:** Rust (abort the reqwest stream) + frontend (Composer stop button, store action)
- **Depends on:** —

There is no way to stop a streaming response once it starts (no abort/cancel anywhere in
`store/threads.ts`, `lib/chat.ts`, or `Composer.tsx`). Add a stop control.

**Acceptance criteria:**
- While `busy`, the Composer shows a **Stop** affordance instead of/alongside Send.
- Stopping halts streaming promptly and persists whatever text was accumulated so far as
  the assistant message (don't lose partial output), clearing `busy`.
- Mechanism crosses the command bridge cleanly — e.g. a cancellation token / abort signal
  the `chat_stream` command observes, or an equivalent approach. Document the choice.

**Notes:**
- 2026-06-09 (Agent B): Cancellation via a shared `CancelFlag(Arc<AtomicBool>)` in Tauri
  managed state. `chat_stream` clears it at the start of each request; the new
  `cancel_stream` command sets it. Each provider polls the flag inside its existing SSE
  `on_data` closure and returns `Ok(false)` to early-exit — the same mechanism used for
  `message_stop` / `[DONE]` — so a cancelled stream still resolves `Ok(ChatResponse{..})`
  with the partial text (nothing lost). `for_each_sse_data`'s signature was left unchanged.
  Frontend: `chat.ts` adds `cancelStream()`; store adds a `cancel()` action + `cancelling`
  flag (the in-flight promise resolves with partial content via the normal completion path,
  persisting only non-empty assistant text); `Composer` shows a destructive **Stop** button
  while `busy`. Verified: `cargo build`/`clippy`/`fmt`, `npm run build`/`lint` all pass.

---

## T4 — Test infrastructure + initial coverage

- **Status:** todo
- **Owner:** —
- **Priority:** P1
- **Layer:** Frontend (Vitest) + Rust (`cargo test`)
- **Depends on:** —

There are **no tests** in the repo (no `*.test.*`, no `#[test]`/`#[cfg(test)]`). Stand up
test tooling and seed it with meaningful unit tests on pure logic. Follow
`superpowers:test-driven-development` for any new code written under later tasks.

**Acceptance criteria:**
- Frontend: Vitest configured with an `npm test` script; cover pure helpers such as
  `deriveTitle`, `lib/image.ts` sizing math, and SSE/message shaping logic that can run
  without the Tauri runtime (mock `@tauri-apps/api` where needed).
- Rust: at least the SSE line driver `for_each_sse_data` (`providers/mod.rs`) and one
  per-provider request/response mapping covered by `cargo test`.
- `npm test` and `cargo test` both pass.

**Notes:**

---

## T5 — KDE/Linux packaging + app branding

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Tooling / config (Rust bundle) + assets
- **Depends on:** —

`npm run tauri build` is intended to produce AppImage/.deb for KDE. `bundle.targets` is
`"all"` but this hasn't been verified on Linux, and the icons appear to be the default
Tauri placeholders.

**Acceptance criteria:**
- Produce real app icons/branding (replace default Tauri icons in `src-tauri/icons/`).
- Verify `npm run tauri build` yields a working AppImage and/or `.deb` on KDE/Linux;
  document any extra system deps required.
- Confirm the global shortcut, tray (T1), and screenshot (`spectacle -r`) work in the
  packaged build on a real KDE session.

**Notes:**
- This requires a Linux/KDE environment; the dev machine is macOS. Mark `blocked` if no
  KDE target is available and note that.

---

## T6 — Error & edge-case hardening

- **Status:** done
- **Owner:** Agent B
- **Priority:** P2
- **Layer:** Frontend + Rust
- **Depends on:** —

Tighten failure UX across the chat path.

**Acceptance criteria:**
- Friendly, actionable errors for: missing API key for the selected provider, network
  failure, provider HTTP/4xx/5xx (surface the provider's error message), and empty/invalid
  model selection.
- Sending is disabled (with a hint) when the selected provider has no stored key
  (`has_api_key`).
- Long/empty/whitespace-only messages and very large pasted images are handled gracefully.

**Notes:**
- 2026-06-09 (Agent B): Errors routed through the store `error` field via a `friendlyError`
  mapper that classifies the raw provider/Tauri message: missing key and empty-model are
  surfaced from Rust with actionable text ("Add one in Settings."); reqwest failures →
  "Network error…"; provider HTTP statuses (401/403/404/429/5xx) get tailored guidance while
  still appending the provider's returned body (each provider module already returns
  `"<provider> error <status>: <body>"` on non-2xx — verified). `chat_stream` rejects an
  empty/whitespace model up front. Send is gated when the selected provider has no stored
  key (`hasApiKey`, re-checked when the provider changes) with a hint in `Composer`; empty/
  whitespace-only sends are a no-op (store + Composer); image prep failures (oversized/
  unsupported) are caught and shown inline instead of throwing. Verified: `npm run build`/
  `lint`, `cargo build`/`clippy`/`fmt` all pass.

---

## T7 — Fix stale status line in CLAUDE.md

- **Status:** todo
- **Owner:** —
- **Priority:** P3 (docs)
- **Layer:** Docs
- **Depends on:** —

`CLAUDE.md` "Project status" still says **"Scaffolded (Stage 0 complete)"**, but Stages
1–6 plus the quick-input/shortcut/screenshot work are implemented in the tree. Update the
status line to reflect reality (and note the remaining gap: system tray, T1).

**Acceptance criteria:**
- "Project status" accurately states what's built vs. outstanding. No other doc churn.

**Notes:**
