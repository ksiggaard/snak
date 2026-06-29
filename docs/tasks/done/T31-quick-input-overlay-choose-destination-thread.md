# T31 — Quick-input overlay: choose destination thread

- **Status:** done
- **Owner:** Agent-T31
- **Priority:** P2
- **Layer:** Frontend (overlay + App handler) + small Rust touch (payload/event)
- **Depends on:** —

(IDEAS 4.) When the global-shortcut overlay (`QuickInput`) opens, let the user choose
where the message goes: default **new thread** (current behavior), or one of the **5 most
recent chats**.

**Acceptance criteria:**
- The overlay shows a destination picker (compact — e.g. a row of chips or a small
  listbox navigable with arrow keys without leaving the input), defaulting to "New chat"
  and listing the 5 most recently updated threads by title.
- Submitting routes correctly: new thread keeps today's `startNewChat()` + `send(...)`
  path; an existing thread selects it (`selectThread`) and sends into it with its saved
  provider/model.
- The overlay still never touches the DB — get recents to it another way (e.g. Rust's
  `show_quick` emits an event the main window answers with the recent-thread list over
  an event to the `quick` window, or main pushes the list whenever threads change).
  Document the choice. `submit_quick`'s payload (`QuickPayload`) gains an optional
  `thread_id`; `App`'s `quick-submit` listener branches on it.
- Works when there are fewer than 5 threads (or none), and a recent that was deleted
  mid-session falls back to "New chat" gracefully.

**Notes:**
- Default shortcut is `Alt+Space` (user-customizable — Ctrl+Space in the idea is just a
  rebinding); behavior must not depend on the specific accelerator.
- Keyboard-first: the overlay is a speed feature — picking a destination must not cost
  the user their typing flow (e.g. Tab cycles destinations, Enter still sends).
- 2026-06-12 (Agent-T31): **Recents delivery — request/answer per show** (chosen over
  push-on-change to avoid emitting to a hidden window on every thread update): Rust
  `show_quick` emits `quick-recents-request` to `main`; App's quick-submit effect answers
  by `emitTo("quick", "quick-recents", recentDestinations(threads))` from the in-memory
  store (no DB query; overlay stays DB-free). Event names + pure helpers
  (`recentDestinations` sort/slice, `cycleDestination`, `destinationThreadId`) in new
  `src/lib/quickDestinations.ts`, 10 Vitest cases in `quickDestinations.test.ts`.
- 2026-06-12 (Agent-T31): Overlay (`QuickInput.tsx`): chip row under the textarea —
  "New chat" (default) + up to 5 recent titles (truncated, radiogroup semantics).
  Tab / Shift+Tab / Ctrl+Up/Down cycles chips without leaving the textarea (chips are
  `tabIndex=-1`; click also selects); Enter still sends; selection resets to "New chat"
  on each show (also handles a recents list that shrank). ModelChooser + "Start chat"
  label only show for the new-chat destination (an existing thread keeps its saved
  provider/model).
- 2026-06-12 (Agent-T31): `QuickPayload` gained optional `thread_id` (snake_case like
  `media_type`; Rust `submit_quick` forwards the payload as opaque `serde_json::Value`,
  so no Rust struct change). App's `quick-submit` listener branches: id present **and**
  still in the store → `selectThread(id)` then `send(...)`; absent/stale → unchanged
  `startNewChat()` + draft provider/model path. No capability edits needed —
  `core:default` already includes `core:event:default` (`allow-emit-to`, verified in
  gen/schemas). Verified: `npm run build`, `npm run lint` (own files; concurrent agents'
  in-flight files caused transient unrelated errors), `npm test` (220 incl. 10 new),
  `cargo build`/`clippy` clean, `cargo fmt --check` clean for `quick.rs` (lib.rs diff
  belongs to the compaction task).
