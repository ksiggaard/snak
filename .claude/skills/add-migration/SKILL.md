---
name: add-migration
description: How to add a SQLite schema migration to snak safely. Use when a feature needs a new table or column, or when asked to "add a migration" / change the database schema.
---

# Adding a SQLite migration

snak's schema is owned by **Rust-registered migrations** that run on app startup. The frontend
owns the *rows* but never the *schema* (ADR-0003).

## Steps

1. **Create the SQL file** — `src-tauri/migrations/NNN_<short_name>.sql`, where `NNN` is the next
   zero-padded number after the current highest (check `ls src-tauri/migrations/ | tail -1`).
   Write forward-only DDL. **Never edit a migration that has shipped** — add a new one instead.
2. **Register it** — in `migrations()` in **`src-tauri/src/lib.rs`**, add a `Migration` entry with
   the next `version` (one higher than the last), embedding the SQL via `include_str!`. Keep
   `version` and the file's `NNN` in lockstep.
3. **Frontend access** — add/extend typed helpers in **`src/lib/db.ts`** (the only place that calls
   the DB; one connection via `getDb()`). Add domain types to `src/types/db.ts`.
4. **Deletes** — FK `ON DELETE CASCADE` is **not** relied on (the plugin connection may lack
   `PRAGMA foreign_keys = ON`). If you add a child table, delete its rows explicitly (see how
   `deleteThread` removes children).

## Gotchas

- **`DB_URL` is duplicated** — `sqlite:snak.db` lives in both `src-tauri/src/lib.rs` and
  `src/lib/db.ts`. If you ever change it, change both.
- Web-only mode (`npm run dev` in a browser) uses an in-memory fake DB (`src/lib/webdb.ts`), not
  your migration. Test schema changes in `npm run tauri dev`.

## Verify

- `cargo build` in `src-tauri/` (migrations compile + embed), then launch `npm run tauri dev` and
  confirm the app starts (migrations run at startup) and the new helper round-trips.
- `npm run build` for the frontend types.

## Reference

ADR-0003 (the frontend owns the database); `AGENTS.md` §Data layer.
