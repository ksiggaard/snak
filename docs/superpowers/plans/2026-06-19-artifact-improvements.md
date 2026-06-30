> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Artifact Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add per-file AI editing, an Edit button, and an independent Artifacts Library sidebar section — plus fix the AI bar race condition.

**Architecture:** New `library_artifacts` DB table (migration 030) with frontend CRUD in `db.ts` and a `useLibrary` Zustand store. The `ArtifactViewer` gains `libraryId`, `editProvider`/`editModel`, and `onSaveToLibrary` props for dual-mode operation. A new `ArtifactsPane` sidebar component lists saved artifacts; selecting one opens the viewer in the main pane. The per-file AI bar renders below `ArtifactCodeEditor` with a new system prompt. Sidebar gains a 4th rail section (`"artifacts"`, `Library` icon).

**Tech Stack:** React 19, TypeScript, Zustand, Tauri v2, SQLite (tauri-plugin-sql), CodeMirror (lazy), lucide-react icons

## Global Constraints

- Follow existing i18n key naming: dotted, namespaced (`artifact.`, `sidebar.`, `library.`)
- Plugin-gating: the artifact renderer (`com.snak.artifacts`) already gates `CodeBlock` dispatch; no new plugin needed
- No FK CASCADE reliance — delete children explicitly
- Migration version increments: next is 30 (`030_library_artifacts.sql`)
- Files `files` column is JSON `[{path, content}]` — same shape as `artifacts`
- Sidebar mode persisted via `storeSidebarMode` / `getStoredSidebarMode`

---

### Task 1: DB migration + Rust registration

**Files:**
- Create: `src-tauri/migrations/030_library_artifacts.sql`
- Modify: `src-tauri/src/lib.rs` (add migration entry)

**Interfaces:**
- Produces: `library_artifacts` table with columns `id, title, files, created_at, updated_at`

- [ ] **Step 1: Write migration SQL**

Create `src-tauri/migrations/030_library_artifacts.sql`:

```sql
CREATE TABLE IF NOT EXISTS library_artifacts (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    files      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Register migration in lib.rs**

In `src-tauri/src/lib.rs`, after the version 29 migration entry, add:

```rust
Migration {
    version: 30,
    description: "library_artifacts: saved independent artifact copies",
    sql: include_str!("../migrations/030_library_artifacts.sql"),
    kind: MigrationKind::Up,
},
```

- [ ] **Step 3: Build to verify**

```bash
cargo build 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/030_library_artifacts.sql src-tauri/src/lib.rs
git commit -m "feat: add library_artifacts migration (030)"
```

---

### Task 2: Library artifact types

**Files:**
- Modify: `src/types/db.ts` (add `LibraryArtifact` interface)

**Interfaces:**
- Produces: `LibraryArtifact` type consumed by Task 3 (store/DB)

- [ ] **Step 1: Add LibraryArtifact type**

In `src/types/db.ts`, after the `Artifact` interface, add:

```ts
/** A saved library artifact (migration 030): an independent copy of an
 *  artifact, untethered from any thread or message. */
export interface LibraryArtifact {
  id: string;
  title: string;
  files: ArtifactFile[];
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/db.ts
git commit -m "feat: add LibraryArtifact type"
```

---

### Task 3: Library artifact DB functions

**Files:**
- Modify: `src/lib/db.ts` (add 6 functions after artifact section)

**Interfaces:**
- Consumes: `LibraryArtifact` from Task 2
- Produces: `saveLibraryArtifact`, `getLibraryArtifact`, `listLibraryArtifacts`, `updateLibraryArtifactFiles`, `deleteLibraryArtifact`, `renameLibraryArtifact`

- [ ] **Step 1: Add DB row type and mapper**

After the artifacts section in `src/lib/db.ts`, add:

```ts
// ---------------------------------------------------------------------------
// Library artifacts (migration 030): saved independent artifact copies
// ---------------------------------------------------------------------------

interface LibraryArtifactRow {
  id: string;
  title: string;
  files: string;
  created_at: string;
  updated_at: string;
}

function mapLibraryArtifact(row: LibraryArtifactRow): LibraryArtifact {
  let files: ArtifactFile[] = [];
  try {
    const parsed = JSON.parse(row.files);
    if (Array.isArray(parsed)) files = parsed as ArtifactFile[];
  } catch { /* corrupt JSON → empty */ }
  return { ...row, files };
}
```

- [ ] **Step 2: Add saveLibraryArtifact**

```ts
export async function saveLibraryArtifact(
  title: string,
  files: ArtifactFile[],
): Promise<LibraryArtifact> {
  const db = await getDb();
  const id = newId();
  // Auto-suffix duplicate titles
  const existing = await db.select<{ title: string }[]>(
    `SELECT title FROM library_artifacts WHERE title = $1 LIMIT 1`,
    [title],
  );
  let finalTitle = title;
  if (existing.length > 0) {
    let n = 2;
    while (true) {
      const candidate = `${title} (${n})`;
      const dups = await db.select<{ title: string }[]>(
        `SELECT title FROM library_artifacts WHERE title = $1 LIMIT 1`,
        [candidate],
      );
      if (dups.length === 0) { finalTitle = candidate; break; }
      n++;
    }
  }
  await db.execute(
    `INSERT INTO library_artifacts (id, title, files)
     VALUES ($1, $2, $3)`,
    [id, finalTitle, JSON.stringify(files)],
  );
  const rows = await db.select<LibraryArtifactRow[]>(
    `SELECT * FROM library_artifacts WHERE id = $1`,
    [id],
  );
  return mapLibraryArtifact(rows[0]);
}
```

- [ ] **Step 3: Add getLibraryArtifact**

```ts
export async function getLibraryArtifact(
  id: string,
): Promise<LibraryArtifact | null> {
  const db = await getDb();
  const rows = await db.select<LibraryArtifactRow[]>(
    `SELECT * FROM library_artifacts WHERE id = $1`,
    [id],
  );
  return rows.length > 0 ? mapLibraryArtifact(rows[0]) : null;
}
```

- [ ] **Step 4: Add listLibraryArtifacts**

```ts
export async function listLibraryArtifacts(): Promise<LibraryArtifact[]> {
  const db = await getDb();
  const rows = await db.select<LibraryArtifactRow[]>(
    `SELECT * FROM library_artifacts ORDER BY updated_at DESC`,
  );
  return rows.map(mapLibraryArtifact);
}
```

- [ ] **Step 5: Add updateLibraryArtifactFiles**

```ts
export async function updateLibraryArtifactFiles(
  id: string,
  files: ArtifactFile[],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE library_artifacts SET files = $2, updated_at = datetime('now') WHERE id = $1`,
    [id, JSON.stringify(files)],
  );
}
```

- [ ] **Step 6: Add deleteLibraryArtifact**

```ts
export async function deleteLibraryArtifact(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM library_artifacts WHERE id = $1`,
    [id],
  );
}
```

- [ ] **Step 7: Add renameLibraryArtifact**

```ts
export async function renameLibraryArtifact(
  id: string,
  title: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE library_artifacts SET title = $2, updated_at = datetime('now') WHERE id = $1`,
    [id, title],
  );
}
```

- [ ] **Step 8: Add LibraryArtifact import**

At the top of `src/lib/db.ts`, add `LibraryArtifact` to the existing type import from `@/types/db`.

- [ ] **Step 9: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/db.ts src/types/db.ts
git commit -m "feat: add library artifact DB CRUD functions"
```

---

### Task 4: i18n keys

**Files:**
- Modify: `src/lib/i18n.ts` (add new keys in Artifacts section)

**Interfaces:**
- Produces: `MessageKey` union extended — consumed by all UI tasks

- [ ] **Step 1: Add new i18n keys**

In `src/lib/i18n.ts`, after `"artifact.fileCount.other"`, add:

```ts
"artifact.edit": "Edit",
"artifact.saving": "Saving…",
"artifact.saveToLibrary": "Save to library",
"artifact.savedToLibrary": "Saved to library",
"artifact.editFile": "Edit {file}",
"artifact.editingFile": "Editing {file}…",
"artifact.editNoThreadLibrary":
  "Open a chat first to use AI editing with a provider.",

// --- Artifacts Library sidebar -----------------------------------------------
"sidebar.artifacts": "Artifacts",
"library.empty":
  "No saved artifacts yet. Save one from a chat or create a new one.",
"library.new": "New artifact",
"library.deleteTooltip": "Delete artifact",
"library.deleteConfirm": "Delete this saved artifact?",
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat: add i18n keys for artifact improvements"
```

---

### Task 5: Layout type update

**Files:**
- Modify: `src/lib/layout.ts` (extend `SidebarMode` type and `getStoredSidebarMode`)

**Interfaces:**
- Produces: `SidebarMode` now `"chats" | "projects" | "bots" | "artifacts"`

- [ ] **Step 1: Extend SidebarMode type**

Change line 6 in `src/lib/layout.ts`:

```ts
export type SidebarMode = "chats" | "projects" | "bots" | "artifacts";
```

- [ ] **Step 2: Update getStoredSidebarMode**

Change the return guard to include `"artifacts"`:

```ts
export function getStoredSidebarMode(): SidebarMode {
  const raw = localStorage.getItem(MODE_KEY);
  return raw === "projects" || raw === "bots" || raw === "artifacts" ? raw : "chats";
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: May surface TS exhaustiveness errors in `SidebarPane.tsx` — expected, fixed in Task 13.

- [ ] **Step 4: Commit**

```bash
git add src/lib/layout.ts
git commit -m "feat: add artifacts to SidebarMode type"
```

---

### Task 6: useLibrary store

**Files:**
- Create: `src/store/library.ts`

**Interfaces:**
- Consumes: DB functions from Task 3
- Produces: `useLibrary` hook with `items`, `openId`, `load`, `setOpenId`, `save`, `update`, `remove`, `rename`

- [ ] **Step 1: Create useLibrary store**

Create `src/store/library.ts` with the Zustand store providing all CRUD operations. Include `setOpenId` for controlling which artifact is displayed in the main pane.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/store/library.ts
git commit -m "feat: add useLibrary Zustand store"
```

---

### Task 7: Fix AI bar race condition

**Files:**
- Modify: `src/components/chat/ArtifactViewer.tsx`

**Interfaces:**
- Consumes: none
- Produces: AI bar always rendered, disabled when `artifactId` is null

- [ ] **Step 1: Remove conditional gate, add disabled state**

Replace `{artifactId && (` with always-rendered bar. Input disabled when `!artifactId`, placeholder shows `t("artifact.saving")`, send button disabled when `!artifactId`.

- [ ] **Step 2: Typecheck and verify**

```bash
npx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ArtifactViewer.tsx
git commit -m "fix: always render AI bar, disable while artifact is persisting"
```

---

### Task 8: Per-file system prompt

**Files:**
- Modify: `src/lib/artifacts.ts`

**Interfaces:**
- Produces: `ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT` constant

- [ ] **Step 1: Add constant**

After `ARTIFACT_EDITOR_SYSTEM_PROMPT`, add `ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT`.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/artifacts.ts
git commit -m "feat: add ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT"
```

---

### Task 9: Per-file AI bar in ArtifactViewer

**Files:**
- Modify: `src/components/chat/ArtifactViewer.tsx`

**Interfaces:**
- Consumes: `ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT` from Task 8
- Produces: per-file AI bar in Code/Split modes; new `editProvider`/`editModel` props

- [ ] **Step 1: Add new props and state for per-file editing**
- [ ] **Step 2: Add runFileEdit callback**
- [ ] **Step 3: Render per-file AI bar below code editor**
- [ ] **Step 4: Typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ArtifactViewer.tsx src/lib/artifacts.ts
git commit -m "feat: add per-file AI editing bar"
```

---

### Task 10: Edit button on ArtifactCard

**Files:**
- Modify: `src/components/chat/ArtifactCard.tsx`

**Interfaces:**
- Produces: Edit button on inline card header

- [ ] **Step 1: Add Pencil icon import and Edit button**
- [ ] **Step 2: Typecheck**
- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ArtifactCard.tsx
git commit -m "feat: add Edit button to artifact inline card"
```

---

### Task 11: Save to library buttons

**Files:**
- Modify: `src/components/chat/ArtifactCard.tsx`
- Modify: `src/components/chat/ArtifactViewer.tsx`

**Interfaces:**
- Consumes: `useLibrary` from Task 6
- Produces: Save-to-library buttons on card + viewer toolbar

- [ ] **Step 1: Add Save to Library button on card**
- [ ] **Step 2: Add onSaveToLibrary prop and toolbar button to viewer**
- [ ] **Step 3: Typecheck**
- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ArtifactCard.tsx src/components/chat/ArtifactViewer.tsx
git commit -m "feat: add Save to library buttons"
```

---

### Task 12: ArtifactsPane sidebar component

**Files:**
- Create: `src/components/sidebar/ArtifactsPane.tsx`

**Interfaces:**
- Consumes: `useLibrary` from Task 6, `useView`
- Produces: `ArtifactsPane` component

- [ ] **Step 1: Create ArtifactsPane with list, rename, delete**
- [ ] **Step 2: Typecheck**
- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/ArtifactsPane.tsx
git commit -m "feat: add ArtifactsPane sidebar component"
```

---

### Task 13: SidebarRail + SidebarPane integration

**Files:**
- Modify: `src/components/sidebar/SidebarRail.tsx`
- Modify: `src/components/sidebar/SidebarPane.tsx`

**Interfaces:**
- Consumes: `SidebarMode` from Task 5, `ArtifactsPane` from Task 12
- Produces: integrated sidebar with 4th tab

- [ ] **Step 1: Add Library icon + section to SECTIONS array**
- [ ] **Step 2: Route artifacts mode in SidebarPane (title, buttons, pane)**
- [ ] **Step 3: Typecheck**
- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/SidebarRail.tsx src/components/sidebar/SidebarPane.tsx
git commit -m "feat: integrate Artifacts sidebar section"
```

---

### Task 14: LibraryArtifactView + App.tsx routing

**Files:**
- Create: `src/components/chat/LibraryArtifactView.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useLibrary` from Task 6, `ArtifactViewer`
- Produces: library artifact visible in main pane

- [ ] **Step 1: Create LibraryArtifactView wrapper**
- [ ] **Step 2: Route openLibraryId in App.tsx**
- [ ] **Step 3: Typecheck**
- [ ] **Step 4: Commit**

```bash
git add src/components/chat/LibraryArtifactView.tsx src/App.tsx
git commit -m "feat: add LibraryArtifactView and App.tsx routing"
```

---

### Task 15: ArtifactViewer library mode

**Files:**
- Modify: `src/components/chat/ArtifactViewer.tsx`

**Interfaces:**
- Consumes: `useLibrary` from Task 6, DB functions from Task 3
- Produces: dual-mode ArtifactViewer for chat + library

- [ ] **Step 1: Add libraryId prop, hooks, effectiveId**
- [ ] **Step 2: Update editFile for dual persistence**
- [ ] **Step 3: Update runEdit for dual mode**
- [ ] **Step 4: Update runFileEdit for dual mode**
- [ ] **Step 5: Update AI bar gates to use effectiveId**
- [ ] **Step 6: Typecheck and commit**

```bash
git add src/components/chat/ArtifactViewer.tsx
git commit -m "feat: add library mode to ArtifactViewer"
```

---

### Task 16: Integration test & polish

**Files:**
- Manual verification; no file changes expected

- [ ] **Step 1: Build and launch the app (`npm run tauri dev`)**
- [ ] **Step 2: Verify AI bar race condition fixed**
- [ ] **Step 3: Verify Edit button and per-file editing**
- [ ] **Step 4: Verify Save to library**
- [ ] **Step 5: Verify Artifacts Library sidebar flow**
- [ ] **Step 6: Run lints (`npm run lint`, `cargo clippy`)**
- [ ] **Step 7: Commit any final fixes**
