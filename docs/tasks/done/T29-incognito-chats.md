# T29 — Incognito chats (purged on app exit)

- **Status:** done
- **Owner:** Agent-T29
- **Priority:** P2
- **Layer:** Frontend + DB (migration) + small Rust touch (exit hook)
- **Depends on:** —

(IDEAS 2.) An incognito mode for chats: an incognito thread lives only for the current
app session and is deleted before/when the app closes. Useful for throwaway or sensitive
conversations.

**Acceptance criteria:**
- A way to start an incognito chat (e.g. a toggle on "New chat" / an incognito new-chat
  action in the sidebar and quick overlay), with a clear visual indicator on the thread
  row + chat view while active.
- Incognito threads are flagged in the DB (numbered migration, e.g.
  `threads.ephemeral INTEGER NOT NULL DEFAULT 0`) so they survive *within* a session
  (thread switching still works) but are purged at end-of-session.
- **Purge is crash-safe:** delete all `ephemeral` threads (messages + attachments,
  explicit child deletes like `deleteThread`) on app **startup** (`init()` in
  `store/threads.ts`) in addition to a best-effort purge on quit — so a crash or kill
  never leaks an incognito chat to the next session.
- "App closed" means actual exit, not hide-to-tray (close-to-tray keeps the session
  alive; tray Quit / `quit_app` / window close with close-to-tray off end it).
- Incognito threads never become `last_thread_id`, and their FTS rows are removed by the
  existing delete triggers (verify).

**Notes:**
- Frontend owns the DB (Stage 1), so the startup purge is the authoritative one; a
  Rust exit-hook purge would need its own SQLite access — prefer frontend-only.
- 2026-06-12 (Agent-T29): Migration `010_incognito.sql` (version 10, registered in
  `migrations()` in `src-tauri/src/lib.rs`): `threads.ephemeral INTEGER NOT NULL
  DEFAULT 0`. `Thread` type gains `ephemeral`; `createThread` accepts an `ephemeral`
  flag; new `purgeEphemeralThreads()` in `src/lib/db.ts` deletes all ephemeral threads
  with explicit child deletes (attachments → usage → messages → threads), mirroring
  `deleteThread`. FTS verified: the migration-004 `search_fts` delete triggers fire per
  deleted message/thread row, so index entries are cleaned automatically.
- 2026-06-12 (Agent-T29): Store (`store/threads.ts`): `startNewChat(opts?: {
  incognito?: boolean })` sets a new `draftIncognito` flag (reset by plain
  `startNewChat` and `startNewChatInProject`); the first `send`/`postNote` creates the
  thread with `ephemeral = 1`. **Crash-safe purge:** `init()` awaits
  `purgeEphemeralThreads()` FIRST, before listing threads / restoring
  `last_thread_id`. `last_thread_id` exclusion: `send`/`postNote` skip the write for
  ephemeral threads, and `selectThread` gates it via the pure, unit-tested
  `shouldRememberThread()` (unknown thread → remember, preserving pre-T29 behavior).
- 2026-06-12 (Agent-T29): Quit semantics: tray Quit / File→Quit call `app.exit` in
  Rust — the frontend cannot intercept those, so the startup purge is the documented
  guarantee for them (and for crashes/kills). Best-effort quit purge added in
  `App.tsx` via `onCloseRequested`: registering the JS listener defers the close, so
  when close-to-tray is OFF we purge then let the window be destroyed; when ON we
  `preventDefault()` (the Rust handler already hid the window — the JS wrapper would
  otherwise `destroy()` it and break hide-to-tray), keeping the session and its
  incognito threads alive.
- 2026-06-12 (Agent-T29): UI: Ghost icon button next to "New chat" in the sidebar
  (chats mode); `ThreadRow` shows a Ghost badge + muted italic title with an
  explanatory tooltip; `ChatView` shows "Incognito — this chat is deleted when the app
  exits." above the composer for an incognito thread or draft. Incognito threads
  otherwise behave normally (rename/delete/favorite/switching). Quick overlay
  (`QuickInput`) incognito path is out of scope per task guidance — not added (sending
  into an existing incognito thread from the overlay still works and stays ephemeral).
- 2026-06-12 (Agent-T29): Tests: new `store/threads.incognito.test.ts` (purge-before-
  list ordering in `init`, `last_thread_id` gating, draft-flag lifecycle,
  `shouldRememberThread`); `threads.defaultModel.test.ts` mock extended with
  `purgeEphemeralThreads`. Verified: `npm run build`, `npm run lint`, `npm test`
  (252 passed), `cargo build`, `cargo clippy`, `cargo fmt --check` — all green.
