# T62 — Per-workspace isolated, toggleable memory

- **Status:** done
- **Owner:** Claude (T62)
- **Priority:** P3
- **Layer:** Rust (migration) + Frontend
- **Depends on:** T58, the memory feature (migration 005)

(IDEAS 3e.) Give each workspace its own **isolated memory**, separate from the global memory
(migration 005), editable in the workspace UI and **toggleable on/off per workspace**.

**Acceptance criteria:**
- Per-workspace memory storage (new migration: a `workspace_id`-scoped memory table or
  column), editable in the workspace UI.
- A per-workspace enable/disable toggle for injecting that memory.
- When in a workspace with it enabled, the workspace memory composes into the system context
  (the `src/lib/systemContext.ts` seam); global memory behavior outside workspaces is
  unchanged.

**Notes (2026-06-17, Claude):**
- Migration 025 (`025_workspace_memory.sql`): new `workspace_memory` table (id, workspace_id,
  content, timestamps, index on workspace_id) + `ALTER TABLE workspaces ADD COLUMN
  memory_enabled INTEGER NOT NULL DEFAULT 1`.
- `WorkspaceMemory` type added to `src/types/db.ts`; `Workspace.memory_enabled` field added.
  `deleteWorkspace` in `db.ts` now also deletes workspace memory rows explicitly (same pattern
  as workspace files — no FK cascade relied upon).
- `buildWorkspaceMemoryText` added to `src/lib/systemContext.ts` (pure fn, heading "Memory for
  this workspace:", mirrors `buildGlobalSystemText` for user memory). Unit-tested in
  `systemContext.test.ts`.
- Injection point: `loadSharedSystemBlocks` in `src/store/threads.ts` — when the thread's
  workspace has `memory_enabled = 1`, workspace memory is fetched and pushed as an additional
  system block in `tail` (after the workspace instructions/files block). Global memory is
  untouched — workspace memory is **additive**, not a replacement. This satisfies the
  acceptance criteria exactly.
- UI: `WorkspaceView.tsx` has a new "Workspace memory" section with a `Switch` toggle
  (on/off, bound to `memory_enabled`), an inline editable list of entries (blur-to-save), and
  an add form — mirroring the pattern in `settings/Memory.tsx`.
- Store: `useWorkspaces` gained `openWorkspaceMemory`, `addMemory`, `updateMemory`,
  `removeMemory`, `setMemoryEnabled`.
- i18n: 6 new keys under `workspace.memory*` added to `src/lib/i18n.ts` and all 5 bundled
  locale packs (de/fr/pl/es/da). `locales.test.ts` passes.
