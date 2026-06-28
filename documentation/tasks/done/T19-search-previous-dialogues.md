# T19 — Search previous dialogues

- **Status:** done
- **Owner:** Wave3-T19
- **Priority:** P2
- **Layer:** Frontend + DB
- **Depends on:** —

Let users search across their chat history — a rich search field plus a results page —
to find and jump back into past conversations. History lives in the `threads`/`messages`
tables (SQLite via `tauri-plugin-sql`); add typed query helpers in `src/lib/db.ts`.

**Acceptance criteria:**
- A search field (in the sidebar/`ThreadList` and/or a global shortcut) that queries both
  thread titles and message content.
- A results page/view showing matches grouped by thread, with a snippet of the matching
  text and the matched terms highlighted; selecting a result opens that thread (and ideally
  scrolls to the matching message).
- Reasonably fast on large histories — consider a SQLite **FTS5** virtual table populated
  via a numbered migration in `src-tauri/migrations/` (kept in sync on message insert),
  rather than naive `LIKE` scans.
- Empty/no-results state and clearing the search are handled cleanly.

**Notes:**
- If FTS5 is used, decide how the index stays current (triggers vs. app-side writes) and
  document it; never edit a shipped migration — add a new numbered one.
- 2026-06-09 (Wave3-T19): FTS5 virtual table `search_fts` (migration **004**) over thread
  titles + message content, tokenize `porter unicode61`. Kept in sync via SQLite **triggers**
  on `threads`/`messages` insert/update/delete (chosen over app-side writes so the index
  can't drift), with a one-time backfill of pre-existing rows. FTS5 availability confirmed
  (libsqlite3-sys bundled SQLite compiled with `-DSQLITE_ENABLE_FTS5`); a `LIKE` fallback is
  kept as defence-in-depth. Search helpers in `src/lib/db.ts` + `src/lib/search.ts` (pure
  snippet/highlight), `src/store/search.ts`, UI in `src/components/search/` (field + grouped
  results with highlighted snippets); opening a result calls the existing `selectThread` and
  scrolls to + briefly flashes the matched message in `MessageList.tsx`. Empty/no-results +
  clear handled. Verified: `npm run build`/`lint`/`test` (94) + `cargo build`/`clippy`/`fmt`.
