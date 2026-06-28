# 0003. The frontend owns the database

- **Status:** Accepted
- **Date:** 2026-06-28

## Context

Chat history lives in on-device SQLite (`tauri-plugin-sql`). Both layers *could* write it:
the Rust streaming command could persist messages as it goes, or the React frontend could
own all SQL. Splitting writes across both layers means two places construct rows, two places
to keep schema-aware, and ordering races between "stream finished in Rust" and "store updated
in JS".

## Decision

**All SQL stays in the frontend.** Access goes through typed helpers in `src/lib/db.ts` (one
connection via `getDb()`); domain types in `src/types/db.ts`. The Zustand store
(`src/store/threads.ts`) persists the user message, gathers history, calls `chatStream`, then
persists the returned authoritative assistant text. The Rust `chat_stream` command
**never touches the DB** — it only streams and returns text.

## Consequences

- One owner for persistence; the store orchestrates message lifecycle end to end (placeholder
  `STREAM_ID` message during streaming, swapped for the persisted row on completion).
- Rust stays stateless w.r.t. chat history — easier to reason about and test.
- `DB_URL` (`sqlite:snak.db`) is duplicated in `src-tauri/src/lib.rs` and `src/lib/db.ts`;
  keep them in sync. Migrations are still Rust-registered (run at startup); the frontend only
  reads/writes rows, never schema.
- FK `ON DELETE CASCADE` isn't relied on (the plugin connection may lack
  `PRAGMA foreign_keys = ON`) — `deleteThread` removes children explicitly.
