# T61 — Per-chat workspace file selection

- **Status:** done
- **Owner:** Claude (T61)
- **Priority:** P2
- **Layer:** Frontend (+ store/DB for persistence)
- **Depends on:** T58

(IDEAS 3d.) When opening or creating a chat in a workspace, let the user choose which
workspace files are relevant to that chat — **all selected by default**. Only the selected
files are injected into the chat's system context.

**Acceptance criteria:**
- A per-chat file selector that defaults to all-selected.
- System-context injection (`buildWorkspaceSystemText` + `loadSharedSystemBlocks` in
  `src/store/threads.ts`) honors the selection rather than always injecting every file.
- The selection persists per thread.

**Notes:**
- 2026-06-17 (Claude, T61): Implemented with the "store excluded" model: migration `024`
  adds a nullable `threads.workspace_files_excluded TEXT` column holding a JSON array of
  de-selected workspace-file ids (NULL/empty = nothing excluded = all selected). This gives
  correct default-all-selected semantics and auto-includes files added to the workspace later.
  - **Filter point:** `loadSharedSystemBlocks` in `src/store/threads.ts` now takes an
    optional `excludedFileIds` param; after loading workspace files it calls
    `filterWorkspaceFiles(files, excludedIds)` (new pure helper in `src/lib/workspaces.ts`)
    before passing the result to `buildWorkspaceSystemText`. All four call sites (send,
    regenerate, requestSources, refreshSystemTokens) pass the excluded set, so all paths
    honour the selection.
  - **Draft-thread handling:** draft threads (unsaved) carry excluded ids in a new
    `draftExcludedFileIds: string[]` store field (reset to `[]` on new-chat actions). On
    first `send()` the draft ids are written to the new thread row via
    `setThreadWorkspaceFilesExcluded`. Saved threads read from `thread.workspace_files_excluded`.
  - **UI:** `src/components/chat/WorkspaceFileSelector.tsx` — a small button in the
    Composer's bottom toolbar (to the left of the ModelPicker) showing "All files included" /
    "{n} / {total} files included" / "No files included". Clicking opens a custom dropdown
    (same pattern as ModelChooser) with a checkbox per file. Only shown when the current
    thread/draft belongs to a workspace with ≥1 file.
  - **Parsing helper:** `parseExcludedFileIds` (module-private in `threads.ts`) safely
    parses the stored JSON; `filterWorkspaceFiles` is fully unit-tested (8 new tests in
    `workspaces.test.ts`, TDD red-green-refactor).
  - **i18n:** 6 new keys (`workspace.fileSelector`, `workspace.fileSelectorHint`,
    `workspace.fileSelectorAll`, `workspace.fileSelectorSome`, `workspace.fileSelectorNone`,
    `workspace.fileSelectorNoFiles`) added to the TS catalog and all 5 packs (de/fr/pl/es/da).
  - Gate: `npm run build` ✓ (0 tsc errors), `npm run lint` ✓, `npm test` (650 pass) ✓,
    `cargo build` ✓, `cargo clippy` ✓ (1 pre-existing warning), `cargo fmt --check` ✓.
