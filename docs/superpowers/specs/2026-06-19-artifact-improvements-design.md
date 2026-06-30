> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Artifact Improvements: Edit Button, Per-File Editing & Library

## Summary

Three improvements to the artifact feature:

1. **Fix missing AI editor bar** — race condition where the bar doesn't render when opening the viewer before the artifact is persisted to DB.
2. **Add Edit button + per-file AI editing** — inline card gets an Edit button; the viewer gets a per-file AI editor bar below the code editor that targets only the selected file.
3. **Artifacts library** — a new sidebar section where artifacts saved from chat live as independent copies, viewable/editable outside any thread.

---

## 1. Fix Missing AI Editor Bar

### Root Cause

`ArtifactViewer.tsx` line 367: `{artifactId && (<div>...AI bar...</div>)}`. `artifactId` is `null` until `ArtifactCard`'s async `ensure()` (DB upsert) resolves. If the user opens the viewer before the promise settles, the bar never mounts. React re-renders *can* deliver the ID later, but the `alive` guard in the `useEffect` cleanup can swallow the `setState` under rapid re-renders or StrictMode double-effects.

### Fix

Remove the `{artifactId && ...}` gate. Always render the AI bar. When `artifactId` is `null`:

- Input is disabled, placeholder shows i18n key `artifact.saving` ("Saving…")
- Send button stays disabled
- Once `artifactId` arrives (prop update), the bar activates normally

The per-file AI bar (new) follows the same pattern — always rendered, disabled while saving.

The existing `runEdit` already guards on `!artifactId` at send time (line 121), so no risk of sending without a persisted artifact.

---

## 2. Edit Button on Inline Card

### New Button

Add a 4th action button to `ArtifactCard`'s header row, alongside Pause/Run, Code, Open:

- **Icon:** `Pencil` (lucide)
- **Label:** `artifact.edit` ("Edit")
- **Action:** Opens `ArtifactViewer` in Split mode with the first file selected (so user sees code + preview immediately, with the per-file AI bar ready)
- **Styling:** Same `HEADER_ACTION_CLASS` as existing buttons

### Button Order

`Pause/Run · Code · Edit · Open`

(Edit sits between Code and Open — adjacent to Code since they're both editing actions.)

---

## 3. Per-File AI Editing

### New AI Bar (below code editor)

A second AI input bar renders **below `ArtifactCodeEditor`** inside the editor pane, only when `showsEditor` is true (Code or Split mode).

**Layout:**
```
┌─────────────────────────────────────────────┐
│  ArtifactCodeEditor (selected file)          │
│  ...                                         │
├─────────────────────────────────────────────┤
│ ✨ Editing app.js                            │
│ [Edit app.js…                    ] [Send]   │
└─────────────────────────────────────────────┘
```

**Behavior:**
- Visible when `showsEditor` is true and artifact is persisted (same disabled-while-saving pattern as full bar)
- Scope indicator line: "Editing {file}" (i18n key `artifact.editingFile`) above the input
- Sends only the selected file + user instruction to the model
- New system prompt: `ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT` (see section 4)
- Streaming: deltas stream into the selected file's editor pane live (same pattern as full-artifact bar, but only updating one file)
- On completion: replaces only that file in `files` state, persists via `update(artifactId, files)`

### Mutual Exclusion

Only one AI bar is active at a time:
- When the per-file bar is generating → full-artifact bar is hidden
- When the full-artifact bar is generating → per-file bar is hidden
- Both share the existing `generating` state flag (no new state needed)

### System Prompt

`ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT`:

```
You are editing a single file inside a multi-file web artifact.
Apply the user's requested change and return ONLY that file's updated content
as a fenced code block tagged `artifact` containing just that one file.
Rules:
- Return the file in full — never abbreviate or use placeholders.
- Use the format: `--- <path> ---` followed by the complete file contents.
- Output only the artifact block — no explanation before or after it.
```

### Response Parsing

The per-file AI response is parsed with the existing `parseArtifact` / `extractArtifactBlock`. The parser finds the single file in the block and replaces only that file in the viewer's `files` state. If the response contains multiple files (model error), only the file matching the selected path is kept.

---

## 4. Artifacts Library

### Concept

A fourth sidebar section ("Artifacts") where users save artifact copies independent of chat threads. Saved artifacts live in a separate DB table (`library_artifacts`) and can be viewed, manually edited, AI-edited, exported, and deleted.

### Database

New migration `030_library_artifacts.sql`:

```sql
CREATE TABLE IF NOT EXISTS library_artifacts (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    files      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`files` is JSON `[{path, content}]` — same shape as `artifacts.files`.

No FK to threads or messages — library artifacts are independent.

### Saving from Chat

**Trigger:** "Save to library" button:
- On the inline card header (between Edit and Open)
- In the viewer toolbar (alongside Export/Open in browser)

**Flow:**
1. User clicks → `saveLibraryArtifact(title, files)` inserts a new row with a fresh UUID
2. Shows a brief toast/snackbar: `artifact.savedToLibrary` ("Saved to library")
3. **Duplicate titles:** auto-suffix `" (2)"`, `" (3)"` — user can rename later

**Button order on card:** `Pause/Run · Code · Edit · Save to library · Open`

### Sidebar Integration

- **Rail icon:** 4th section — id `"artifacts"`, label `sidebar.artifacts` ("Artifacts"), icon `Library` (lucide)
- **`SidebarMode` type** (`src/lib/layout.ts`): extends to `"chats" | "projects" | "bots" | "artifacts"`
- **`SidebarPane.tsx`:** routes `"artifacts"` to `<ArtifactsPane />`
- **`ArtifactsPane`** (new, `src/components/sidebar/ArtifactsPane.tsx`):
  - Lists all library artifacts sorted by `updated_at DESC`
  - Each row: icon (`FileCode`), title, file count badge, relative timestamp
  - Double-click to rename (inline edit, same pattern as ThreadRow)
  - Click to open in viewer
  - Context menu or hover: Delete (with confirmation)
  - Empty state: `library.empty` ("No saved artifacts") with a subtle illustration or icon
  - "New artifact" button in header: creates a blank artifact with a default `index.html` (scaffolded HTML5 boilerplate)

### Viewing Library Artifacts

Opening a library artifact replaces the main content area with the full `ArtifactViewer`:

- **Same viewer component** — Preview/Split/Code, manual editing, export (.zip), open in browser
- **`libraryId` prop** instead of `artifactId` — viewer adapts: manual edits persist via `updateLibraryArtifactFiles`, not `updateArtifactFiles`
- **AI editing (both full-artifact and per-file):** uses the active chat's provider/model. If no chat is open, falls back to the app's last-used provider/model (read from `settings.last_thread_id` → thread's provider/model, or first available provider from the registry). No thread history — it's a one-off request with system prompt + current artifact + instruction.
- **Renaming:** editable title in the viewer toolbar (inline text edit or a rename button)
- **Return to previous view** on close (chat, settings, etc.)

### ArtifactsPane Actions Summary

| Action | Trigger | Behavior |
|--------|---------|----------|
| Open | Click row | Opens `ArtifactViewer` in main pane |
| Rename | Double-click title | Inline text edit, persists via DB |
| Delete | Hover action / context menu | Confirmation dialog, then deletes from DB. If currently viewing, closes viewer |
| Export | Hover action | Same `exportArtifactZip` command |
| New | Header button | Creates blank artifact, opens in viewer |

### Store

New Zustand store `useLibrary` (`src/store/library.ts`):

```ts
interface LibraryState {
  items: LibraryArtifact[];
  load: () => Promise<void>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  save: (title: string, files: ArtifactFile[]) => Promise<LibraryArtifact>;
  update: (id: string, files: ArtifactFile[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
}
```

### App.tsx Routing

Add a new condition in the main pane view chain (around line 297):

```
if (openLibraryId) → <LibraryArtifactView />
```

`LibraryArtifactView` is a thin wrapper that loads the library artifact from store/DB and renders `<ArtifactViewer libraryId={id} ... />`.

---

## 5. Files Touched

| File | Change |
|------|--------|
| `src/components/chat/ArtifactViewer.tsx` | Remove `{artifactId && }` gate; add per-file AI bar + scope indicator; accept `libraryId` prop for library mode |
| `src/components/chat/ArtifactCard.tsx` | Add Edit button, "Save to library" button |
| `src/lib/artifacts.ts` | Add `ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT` |
| `src/lib/db.ts` | Add library CRUD: `saveLibraryArtifact`, `getLibraryArtifact`, `listLibraryArtifacts`, `updateLibraryArtifactFiles`, `deleteLibraryArtifact`, `renameLibraryArtifact` |
| `src/store/library.ts` | **New** — `useLibrary` Zustand store |
| `src/components/sidebar/SidebarRail.tsx` | Add 4th section `"artifacts"` with `Library` icon |
| `src/components/sidebar/SidebarPane.tsx` | Route `"artifacts"` mode to `ArtifactsPane` |
| `src/components/sidebar/ArtifactsPane.tsx` | **New** — list of library artifacts |
| `src/components/chat/LibraryArtifactView.tsx` | **New** — thin wrapper loading library artifact into viewer |
| `src/lib/layout.ts` | Add `"artifacts"` to `SidebarMode` type |
| `src/App.tsx` | Route library artifact selection to `LibraryArtifactView` in main pane |
| `src/lib/i18n.ts` | New i18n keys (see below) |
| `src/types/db.ts` | Add `LibraryArtifact` type |
| `src-tauri/migrations/030_library_artifacts.sql` | **New** migration |
| `src-tauri/src/lib.rs` | Register migration 030 |

---

## 6. i18n Keys (New)

| Key | English |
|-----|---------|
| `artifact.edit` | Edit |
| `artifact.saveToLibrary` | Save to library |
| `artifact.savedToLibrary` | Saved to library |
| `artifact.editFile` | Edit {file} |
| `artifact.editingFile` | Editing {file}… |
| `artifact.saving` | Saving… |
| `artifact.editNoThreadLibrary` | Open a chat first to use AI editing with a provider. |
| `sidebar.artifacts` | Artifacts |
| `library.empty` | No saved artifacts yet. Save one from a chat or create a new one. |
| `library.new` | New artifact |
| `library.deleteTooltip` | Delete artifact |
| `library.deleteConfirm` | Delete this saved artifact? |

---

## 7. States & Edge Cases

| State | Handling |
|-------|----------|
| AI bar while artifact persisting | Input disabled, shows "Saving…", send disabled |
| AI bar while AI generating | Per-file bar hidden; full-artifact bar hidden; active bar shows Stop |
| No chat open when AI editing library artifact | Fall back to defaultProvider/defaultModel from threads store |
| Save to library with duplicate title | Auto-append " (2)", " (3)" etc. |
| Delete library artifact while viewing | Close viewer, return to previous main-pane view |
| Streaming single-file response | Deltas stream into the selected file's editor pane live |
| Model returns multiple files for single-file request | Only keep the file matching the selected path; discard others |
| Blank new artifact from library | Scaffold a minimal `index.html` with HTML5 boilerplate and empty `style.css`, `script.js` |
| Library artifact identical to chat artifact | No dedup — they're independent copies by design |
