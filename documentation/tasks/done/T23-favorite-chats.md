# T23 — Favorite chats (Favorites section in the sidebar)

- **Status:** done
- **Owner:** WS-C
- **Priority:** P2
- **Layer:** React + Rust (migration)
- **Depends on:** —

Let the user favorite a thread and surface a Favorites group at the top of the sidebar.

**Acceptance criteria:**
- A new numbered migration (next version after `006_models.sql`) adds a `favorite` flag to
  `threads` (e.g. `favorite INTEGER NOT NULL DEFAULT 0`); register it in `lib.rs` — never
  edit a shipped migration.
- `Thread` type gains the field; a typed helper in `src/lib/db.ts` and a `store/threads.ts`
  action toggle it.
- `ThreadList` renders a Favorites group above the normal/grouped list, with a star toggle
  per thread.
- Existing threads default to not-favorited; list ordering stays stable.

- 2026-06-10 (WS-C): Migration **007_favorites.sql** (version 7, registered in `lib.rs`) adds
  `threads.favorite INTEGER NOT NULL DEFAULT 0`. `Thread` gains `favorite: number`; `db.ts`
  adds `setThreadFavorite` (does NOT bump `updated_at`, so favoriting doesn't reorder recents);
  `store/threads.ts` adds a `toggleFavorite(id)` action. The Chats pane (`ChatsPane.tsx`, T24)
  renders a **Favorites** group above the flat "All chats" list, with a star toggle per row
  (`ThreadRow.tsx`). Groups are computed from the live thread list (stale-safe on delete).
