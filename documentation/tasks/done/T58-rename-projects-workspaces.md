# T58 — Rename projects → workspaces (full: DB + code + UI)

- **Status:** done
- **Owner:** Claude (T58)
- **Notes:** 2026-06-17 — Migration 022 renames tables/columns; all code symbols, types, and i18n keys (EN + 5 locale packs) updated; full gate passes (build, lint, 623 tests, cargo build/clippy/fmt).
- **Priority:** P2
- **Layer:** Rust (migration) + Frontend (code symbols + UI + i18n)
- **Depends on:** —

(IDEAS 3a.) Rename the "projects" feature to "workspaces" end-to-end — the database, the
code symbols, and every user-facing string. This is the foundation the rest of the
workspace work (T59–T62) builds on.

**Acceptance criteria:**
- New migration `022_*.sql` renaming `projects` → `workspaces`, `project_files` →
  `workspace_files`, and `threads.project_id` → `threads.workspace_id` (carry the
  `quick_actions` column), via `ALTER TABLE … RENAME`. Never edit a shipped migration;
  register it in `migrations()` in `src-tauri/src/lib.rs`.
- Code symbols renamed: `store/projects.ts` → `store/workspaces.ts`, `lib/projects.ts`,
  `components/projects/*`, `ProjectsPane`, the `Project*` types (`src/types/db.ts`), and the
  `db.ts` helpers (`listProjects`, `createProject`, …).
- All user-facing strings and i18n keys say "workspace" across **all five language packs**.
- Existing data and thread associations survive the migration.
- Full gate green (`npm run build` / `lint` / `test`, `cargo build` / `clippy` / `fmt`).
