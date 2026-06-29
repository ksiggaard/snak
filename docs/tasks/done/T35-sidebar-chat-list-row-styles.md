# T35 — Sidebar chat-list row styles

- **Status:** done
- **Owner:** Agent-T34-T35
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 8.) Customize what a thread row in the sidebar chat list shows. Default stays
title-only; offer richer variants for users who want more context per row.

**Acceptance criteria:**
- An Appearance "Chat list" selector with 4 modes:
  - **Title** (default) — exactly today's single-line row.
  - **Title + date** — second line with the thread's last-activity date (relative for
    recent, e.g. "2h ago", absolute beyond a week; `Intl`-formatted).
  - **Detailed** — title, date, and the thread's provider/model (resolve the model id to
    its configured label where possible).
  - **Preview** — title + a one-line snippet of the last message (truncated, no markdown
    artifacts — strip/flatten formatting).
- Applies to `ThreadRow`/`ChatsPane` (and the Favorites group) without breaking
  double-click-rename, the star toggle, delete, or selection highlighting; row height
  adapts per mode and the list stays smooth with many threads.
- Preview mode sources the last message efficiently — one query for the visible list
  (e.g. a `lastMessage` join helper in `src/lib/db.ts`), not per-row queries; incognito
  (T29, if landed) and empty threads degrade gracefully.
- Persisted like the other appearance prefs (localStorage); the picker shows a small
  inline preview of each style.

**Notes:**
- Composes with T24 (Chats/Projects panes) — Projects mode's thread lists should follow
  the same row style for consistency.
- 2026-06-12 (Agent-T34-T35): Implemented. Pref `chatListStyle`
  (title/title-date/detailed/preview) follows the same pattern as T34: helpers
  in `src/lib/appearance.ts` (localStorage key `chat-list-style`, default
  "title", unit-tested), state on `useAppearance`. `ThreadRow.tsx` renders an
  optional second line under the title (title button became a two-line column;
  rename input, star, delete, selection highlight, and the T29 Ghost
  badge/italic are untouched; row height adapts naturally). Date via new pure
  `formatThreadDate(updatedAt, now)` in `src/lib/time.ts` (relative `relativeTime`
  under 7 days, `Intl.DateTimeFormat` absolute beyond — year only when it
  differs; unit-tested incl. the 7-day boundary). Detailed mode resolves
  provider/model labels via the existing `currentModelLabel`
  (`lib/modelOptions.ts`) against `useProviders()` + the `useModels` store
  (falls back to raw ids).
- 2026-06-12: **Preview sourcing** — new `lastMessages(threadIds)` in
  `src/lib/db.ts`: ONE query joining `messages` on a `MAX(rowid) GROUP BY
  thread_id` subquery filtered to `kind = 'normal'` (decision: T28 summary rows
  are skipped — the last real turn is the useful preview; rowid is used because
  message ids are random UUIDs and created_at has only second resolution).
  Fetched by the shared `useThreadSnippets(threads, enabled)` hook
  (`src/components/sidebar/useThreadSnippets.ts`) — runs ONLY when the style is
  "preview", refreshes when the store's thread list reloads, best-effort on
  error; used by both `ChatsPane` (incl. Favorites group) and `ProjectsPane`
  (`ProjectView` has no thread list, so the two panes cover all renders). The
  snippet is flattened by new pure `flattenSnippet` in `src/lib/markdown.ts`
  (regex flattener: strips fences/headings/lists/quotes/table chrome/inline
  markers, keeps code + link text, collapses to one line, ellipsis-truncates;
  unit-tested). Empty threads get no row → title-only; incognito threads behave
  normally until purge.
- 2026-06-12: Appearance "Chat list" card shows the four options as buttons
  with a tiny static mock row each (`ChatListRowMock` in
  `settings/Appearance.tsx`). Verified: `npm run build`, `npm run lint`,
  `npm test` (274 passed, incl. 22 new T34/T35 tests) green.
