> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Image Drag-to-Replace and Click-for-Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-to-replace and click-for-menu on all image upload surfaces: composer chips, Canvas footer chips, workspace profile circle, and workspace cover banner.

**Architecture:** Extract a reusable `ImageChip` component for composer/canvas thumbnails. Extend workspace images with reposition data (x/y/zoom columns). Add drop handlers and shadcn `DropdownMenu` triggers on all surfaces. Workspace profile gets a reposition overlay with drag-pan + zoom slider; cover gets inline drag reposition.

**Tech Stack:** React 19, TypeScript, shadcn/ui (DropdownMenu), Zustand, SQLite (tauri-plugin-sql), Tailwind v4

## Global Constraints

- New DB migration must be **029** (latest is 028)
- En locale strings are defaults in `src/lib/i18n.ts`; other locales in `src/locales/{code}.json`
- Tauri `include_str!` for migration SQL; register in `migrations()` in `lib.rs`
- Drop non-image files silently; only first file processed per drop
- Profile zoom min = `circleDiameter / min(imageNaturalWidth, imageNaturalHeight)` so circle always covered; max = 3.0

---

### Task 1: DB Migration + Types + Rust Registration

**Files:**
- Create: `src-tauri/migrations/029_image_position.sql`
- Modify: `src-tauri/src/lib.rs:232-237` (append migration)
- Modify: `src/types/db.ts:91-106`

**Interfaces:**
- Produces: `Workspace` type gains fields `profile_image_x: number`, `profile_image_y: number`, `profile_image_zoom: number`, `cover_image_x: number`, `cover_image_y: number`

- [ ] **Step 1: Create migration SQL file**

Create `src-tauri/migrations/029_image_position.sql`:

```sql
ALTER TABLE workspaces ADD COLUMN profile_image_x REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN profile_image_y REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN profile_image_zoom REAL NOT NULL DEFAULT 1.0;
ALTER TABLE workspaces ADD COLUMN cover_image_x REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN cover_image_y REAL NOT NULL DEFAULT 0.5;
```

- [ ] **Step 2: Register migration in Rust**

Add to `src-tauri/src/lib.rs`, after the last `Migration` block (after line 237's `},`):

```rust
        Migration {
            version: 29,
            description: "workspace image reposition (profile x/y/zoom, cover x/y)",
            sql: include_str!("../migrations/029_image_position.sql"),
            kind: MigrationKind::Up,
        },
```

- [ ] **Step 3: Update Workspace type**

Modify `src/types/db.ts`, add fields after `cover_image` (line 103):

```ts
export interface Workspace {
  id: string;
  name: string;
  instructions: string;
  quick_actions: string;
  memory_enabled: number;
  profile_image: string | null;
  cover_image: string | null;
  profile_image_x: number;
  profile_image_y: number;
  profile_image_zoom: number;
  cover_image_x: number;
  cover_image_y: number;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Build Rust to verify migration compiles**

```bash
cargo build
```
Expected: compiles without errors. If `include_str!` path is wrong, Rust will error at compile time.

- [ ] **Step 5: Check Typescript compiles**

```bash
npm run build
```
Expected: no TS errors for the type change.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/migrations/029_image_position.sql src-tauri/src/lib.rs src/types/db.ts
git commit -m "feat: add workspace image reposition columns (migration 029)"
```

---

### Task 2: Extend setWorkspaceImages DB + Store

**Files:**
- Modify: `src/lib/db.ts:866-877`
- Modify: `src/store/workspaces.ts:48-53, 143-146`

**Interfaces:**
- Consumes: `Workspace` type with reposition fields (Task 1)
- Produces: `setWorkspaceImages(id, profileImage, coverImage, profileX?, profileY?, profileZoom?, coverX?, coverY?)` — optional reposition params default to current DB values
- Produces: `useWorkspaces.setImages(id, profileImage, coverImage, profileX?, profileY?, profileZoom?, coverX?, coverY?)`

- [ ] **Step 1: Extend DB function**

Replace `setWorkspaceImages` in `src/lib/db.ts`:

```ts
export async function setWorkspaceImages(
  id: string,
  profileImage: string | null,
  coverImage: string | null,
  profileX?: number,
  profileY?: number,
  profileZoom?: number,
  coverX?: number,
  coverY?: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE workspaces
     SET profile_image = $1, cover_image = $2,
         profile_image_x = $3, profile_image_y = $4, profile_image_zoom = $5,
         cover_image_x = $6, cover_image_y = $7,
         updated_at = datetime('now')
     WHERE id = $8`,
    [
      profileImage,
      coverImage,
      profileX ?? 0.5,
      profileY ?? 0.5,
      profileZoom ?? 1.0,
      coverX ?? 0.5,
      coverY ?? 0.5,
      id,
    ],
  );
}
```

The defaults (`?? 0.5`, `?? 1.0`) ensure existing callers that don't pass reposition params still work — they write the same defaults as the schema.

- [ ] **Step 2: Extend store action**

Replace `setImages` in `src/store/workspaces.ts`:

```ts
setImages: async (
  id,
  profileImage,
  coverImage,
  profileX,
  profileY,
  profileZoom,
  coverX,
  coverY,
) => {
  await setWorkspaceImages(
    id,
    profileImage,
    coverImage,
    profileX,
    profileY,
    profileZoom,
    coverX,
    coverY,
  );
  await get().refresh();
},
```

Update the type declaration in the `WorkspacesState` interface (lines 48-53):

```ts
setImages: (
  id: string,
  profileImage: string | null,
  coverImage: string | null,
  profileX?: number,
  profileY?: number,
  profileZoom?: number,
  coverX?: number,
  coverY?: number,
) => Promise<void>;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```
Expected: no TS errors. Existing callers with 3 args still work (position params are optional).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts src/store/workspaces.ts
git commit -m "feat: extend setWorkspaceImages with reposition params"
```

---

### Task 3: Add i18n Keys

**Files:**
- Modify: `src/lib/i18n.ts` (add after line 811 `workspace.removeCoverImage`)
- Modify: `src/locales/pl.json`
- Modify: `src/locales/de.json`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/da.json`
- Modify: `src/locales/es.json`

**Interfaces:**
- Consumes: none (standalone)
- Produces: i18n keys `composer.replaceImage`, `composer.clearImage`, `workspace.repositionImage`, `workspace.replaceImage`, `workspace.clearImage`, `workspace.imageZoom`

- [ ] **Step 1: Add English defaults to i18n.ts**

Insert after line 811 (`"workspace.removeCoverImage": "Remove cover image",`):

```ts
  "composer.replaceImage": "Replace image",
  "composer.clearImage": "Clear image",
  "workspace.repositionImage": "Reposition",
  "workspace.replaceImage": "Replace image",
  "workspace.clearImage": "Clear image",
  "workspace.imageZoom": "Zoom",
```

- [ ] **Step 2: Add translations to pl.json**

Insert after `"workspace.removeCoverImage": "Usuń zdjęcie okładki",` (line 617):

```json
    "composer.replaceImage": "Zamień obraz",
    "composer.clearImage": "Wyczyść obraz",
    "workspace.repositionImage": "Zmień pozycję",
    "workspace.replaceImage": "Zamień obraz",
    "workspace.clearImage": "Wyczyść obraz",
    "workspace.imageZoom": "Powiększenie",
```

- [ ] **Step 3: Add translations to de.json**

Insert after `"workspace.removeCoverImage": "Titelbild entfernen",` (line 611):

```json
    "composer.replaceImage": "Bild ersetzen",
    "composer.clearImage": "Bild entfernen",
    "workspace.repositionImage": "Positionieren",
    "workspace.replaceImage": "Bild ersetzen",
    "workspace.clearImage": "Bild entfernen",
    "workspace.imageZoom": "Zoom",
```

- [ ] **Step 4: Add translations to fr.json**

Insert after `"workspace.removeCoverImage": "Supprimer l'image de couverture",` (line 605):

```json
    "composer.replaceImage": "Remplacer l'image",
    "composer.clearImage": "Supprimer l'image",
    "workspace.repositionImage": "Repositionner",
    "workspace.replaceImage": "Remplacer l'image",
    "workspace.clearImage": "Supprimer l'image",
    "workspace.imageZoom": "Zoom",
```

- [ ] **Step 5: Add translations to da.json**

Insert after `"workspace.removeCoverImage": "Fjern omslagsbillede",` (line 605):

```json
    "composer.replaceImage": "Erstat billede",
    "composer.clearImage": "Fjern billede",
    "workspace.repositionImage": "Placer",
    "workspace.replaceImage": "Erstat billede",
    "workspace.clearImage": "Fjern billede",
    "workspace.imageZoom": "Zoom",
```

- [ ] **Step 6: Add translations to es.json**

Insert after `"workspace.removeCoverImage": "Eliminar imagen de portada",` (line 605):

```json
    "composer.replaceImage": "Reemplazar imagen",
    "composer.clearImage": "Quitar imagen",
    "workspace.repositionImage": "Reposicionar",
    "workspace.replaceImage": "Reemplazar imagen",
    "workspace.clearImage": "Quitar imagen",
    "workspace.imageZoom": "Zoom",
```

- [ ] **Step 7: Verify**

```bash
npm run lint
```
Expected: no ESLint errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/i18n.ts src/locales/
git commit -m "feat: add i18n keys for image replace/clear/reposition/zoom"
```

---

### Task 4: Create ImageChip Component

**Files:**
- Create: `src/components/chat/ImageChip.tsx`

**Interfaces:**
- Consumes: `PreparedImage` from `src/lib/image.ts`, `DropdownMenu` from `src/components/ui/dropdown-menu.tsx`
- Produces:
  ```ts
  interface ImageChipProps {
    image: PreparedImage;
    index: number;
    onRemove: (index: number) => void;
    onReplace: (index: number, image: PreparedImage) => void;
  }
  ```

- [ ] **Step 1: Write the component**

Create `src/components/chat/ImageChip.tsx`:

```tsx
import { useRef, useState } from "react";
import { X, Image as ImageIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { useT } from "@/store/i18n";

interface ImageChipProps {
  image: PreparedImage;
  index: number;
  onRemove: (index: number) => void;
  onReplace: (index: number, image: PreparedImage) => void;
}

export function ImageChip({
  image,
  index,
  onRemove,
  onReplace,
}: ImageChipProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleReplace(file: File) {
    try {
      const prepared = await prepareImage(file);
      onReplace(index, prepared);
    } catch {
      // Silently ignore — same behavior as existing Composer drop zone.
    }
  }

  return (
    <div
      className="relative shrink-0"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void handleReplace(file);
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`block size-16 rounded-md overflow-hidden border-2 transition-colors ${
              dragOver
                ? "border-primary"
                : "border-transparent hover:border-primary/50"
            }`}
          >
            <img
              src={image.dataUrl}
              alt={t("composer.attachmentPreview")}
              className="size-full object-cover"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36">
          <DropdownMenuItem
            onClick={() => inputRef.current?.click()}
          >
            <ImageIcon className="size-3.5" />
            {t("composer.replaceImage")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onRemove(index)}
          >
            <X className="size-3.5" />
            {t("composer.clearImage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleReplace(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```
Expected: no TS errors. The component compiles standalone (even if no consumer uses it yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ImageChip.tsx
git commit -m "feat: add ImageChip component with drop-to-replace and click menu"
```

---

### Task 5: Integrate ImageChip into Composer

**Files:**
- Modify: `src/components/chat/Composer.tsx:711-727`

**Interfaces:**
- Consumes: `ImageChip` (Task 4)
- Modifies: replaces inline `<img>` + X button markup with `<ImageChip>`

- [ ] **Step 1: Add replaceImage callback and use ImageChip**

In `src/components/chat/Composer.tsx`:

**Import ImageChip** — add after line 16 (after `Canvas` import):

```tsx
import { ImageChip } from "@/components/chat/ImageChip";
```

**Add replaceImage function** — insert after `removeImage` (after line 410):

```tsx
function replaceImage(index: number, prepared: PreparedImage) {
  setImages((prev) => prev.map((img, i) => (i === index ? prepared : img)));
}
```

**Replace the inline thumbnail markup** (lines 711-727 — the `{images.map(...)}` block):

```tsx
{images.map((img, i) => (
  <ImageChip
    key={i}
    image={img}
    index={i}
    onRemove={removeImage}
    onReplace={replaceImage}
  />
))}
```

- [ ] **Step 2: Verify TypeScript compiles and lint passes**

```bash
npm run lint
npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/Composer.tsx
git commit -m "feat: integrate ImageChip into Composer"
```

---

### Task 6: Integrate ImageChip into Canvas

**Files:**
- Modify: `src/components/chat/Canvas.tsx:1-7 (imports), :123-155 (footer images)**

**Interfaces:**
- Consumes: `ImageChip` (Task 4)
- Adds: `onReplaceImage: (index: number, image: PreparedImage) => void` prop

- [ ] **Step 1: Add onReplaceImage prop and use ImageChip**

In `src/components/chat/Canvas.tsx`:

**Import ImageChip** — add after line 4 (after `Markdown` import):

```tsx
import { ImageChip } from "@/components/chat/ImageChip";
```

**Add onReplaceImage to CanvasProps** (after `onRemoveImage` on line 17):

```tsx
  /** Replace an attached image at index with a new prepared image. */
  onReplaceImage: (index: number, image: PreparedImage) => void;
```

**Replace the inline thumbnail markup** (lines 126-145 — the footer images section). Replace:

```tsx
            {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img
                    src={img.dataUrl}
                    alt={t("composer.attachmentPreview")}
                    className="size-10 rounded-md object-cover"
                  />
                  <button
                    type="button"
                    aria-label={t("composer.removeImage")}
                    onClick={() => onRemoveImage(i)}
                    className="bg-background/80 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
```

With:

```tsx
            {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <ImageChip
                  key={i}
                  image={img}
                  index={i}
                  onRemove={onRemoveImage}
                  onReplace={onReplaceImage}
                />
              ))}
            </div>
```

Note: Canvas images use `size-10` thumbnails (via `ImageChip`'s `size-16`? No — `ImageChip` has `size-16` hardcoded. The spec says Canvas uses same markup, but Canvas currently uses `size-10`. We should accept a `size` prop or keep ImageChip at `size-16` for both. Per spec, both surfaces use the same chip — so Canvas chips become `size-16` too. The X button and menu are handled by `ImageChip` internally.)

**Update the Composer's canvas invocation** to pass `onReplaceImage`. In `Composer.tsx`, find the `<Canvas>` element (around line 549) and add the prop:

```tsx
        <Canvas
          text={text}
          onChange={setText}
          images={images}
          onRemoveImage={removeImage}
          onReplaceImage={replaceImage}
          onSend={send}
          canSend={canSend}
          onClose={() => setCanvasOpen(false)}
        />
```

- [ ] **Step 2: Clean up unused imports in Canvas.tsx**

Remove `X` from the lucide-react import in Canvas.tsx if it's no longer used there. Keep it if used elsewhere in the file (it's used for the close button at line 81).

- [ ] **Step 3: Verify**

```bash
npm run lint
npm run build
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/Canvas.tsx src/components/chat/Composer.tsx
git commit -m "feat: integrate ImageChip into Canvas"
```

---

### Task 7: WorkspaceDashboard — Drop-to-Replace + Click Menus

**Files:**
- Modify: `src/components/workspaces/WorkspaceDashboard.tsx:1-11 (imports), :73-116 (cover), :120-158 (profile)**

**Interfaces:**
- Consumes: `DropdownMenu` from `src/components/ui/dropdown-menu.tsx`, `prepareImage` from `src/lib/image.ts`
- Consumes: `setImages` store action with reposition params (Task 2)
- Modifies: adds `onDragOver`/`onDrop` to cover + profile surfaces; wraps them in `DropdownMenu`

- [ ] **Step 1: Add imports**

Update imports in `WorkspaceDashboard.tsx`:

```tsx
import { useRef, useState } from "react";
import { FileText, Globe, Image as ImageIcon, MessageSquare, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaces } from "@/store/workspaces";
import { useThreads } from "@/store/threads";
import { useT } from "@/store/i18n";
import { prepareImage } from "@/lib/image";
import { splitWorkspaceFiles, recentMemories, workspaceFilesSize } from "@/lib/workspaces";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";
```

- [ ] **Step 2: Add drop-to-replace and click menu for cover image**

Replace the cover banner section (lines 76-116). The existing `coverInputRef` is still used for the Replace action.

```tsx
      {/* Cover image banner */}
      <div className="relative h-32 shrink-0 overflow-hidden rounded-t-lg">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div
              className="h-full w-full cursor-pointer"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                if (!file || !workspace) return;
                void (async () => {
                  try {
                    const prepared = await prepareImage(file);
                    await setImages(workspace.id, workspace.profile_image, prepared.base64);
                  } catch { /* ignore non-image drops */ }
                })();
              }}
            >
              {workspace.cover_image ? (
                <img
                  src={`data:image/jpeg;base64,${workspace.cover_image}`}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${workspace.cover_image_x * 100}% ${workspace.cover_image_y * 100}%`,
                  }}
                />
              ) : (
                <div className="from-primary/30 to-primary/10 h-full w-full bg-gradient-to-br" />
              )}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={() => {
                /* Reposition starts inline drag mode — handled in Task 9 */
              }}
            >
              <ImageIcon className="size-3.5" />
              {t("workspace.repositionImage")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => coverInputRef.current?.click()}>
              <ImageIcon className="size-3.5" />
              {t("workspace.replaceImage")}
            </DropdownMenuItem>
            {workspace.cover_image && (
              <DropdownMenuItem onClick={() => void onRemoveCoverImage()}>
                <X className="size-3.5" />
                {t("workspace.clearImage")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPickCoverImage(e.target.files)}
        />
      </div>
```

- [ ] **Step 3: Add drop-to-replace and click menu for profile image**

Replace the profile image section (lines 120-157). The existing `profileInputRef` is still used.

```tsx
        <div className="relative shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div
                className="cursor-pointer"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (!file || !workspace) return;
                  void (async () => {
                    try {
                      const prepared = await prepareImage(file);
                      await setImages(workspace.id, prepared.base64, workspace.cover_image);
                    } catch { /* ignore */ }
                  })();
                }}
              >
                {workspace.profile_image ? (
                  <img
                    src={`data:image/jpeg;base64,${workspace.profile_image}`}
                    alt={workspace.name}
                    className="border-card size-16 rounded-full border-4 object-cover"
                    style={{
                      objectPosition: `${workspace.profile_image_x * 100}% ${workspace.profile_image_y * 100}%`,
                      transform: `scale(${workspace.profile_image_zoom})`,
                      transformOrigin: "center",
                    }}
                  />
                ) : (
                  <div className="border-card bg-primary/20 text-primary flex size-16 items-center justify-center rounded-full border-4 text-xl font-bold">
                    {initial}
                  </div>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem
                onClick={() => {
                  /* Opens reposition overlay — handled in Task 8 */
                }}
              >
                <ImageIcon className="size-3.5" />
                {t("workspace.repositionImage")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => profileInputRef.current?.click()}>
                <ImageIcon className="size-3.5" />
                {t("workspace.replaceImage")}
              </DropdownMenuItem>
              {workspace.profile_image && (
                <DropdownMenuItem onClick={() => void onRemoveProfileImage()}>
                  <X className="size-3.5" />
                  {t("workspace.clearImage")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={profileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickProfileImage(e.target.files)}
          />
        </div>
```

- [ ] **Step 4: Verify**

```bash
npm run lint
npm run build
```
Expected: no errors. The reposition menu items are present but non-functional (handled in Tasks 8 and 9).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspaces/WorkspaceDashboard.tsx
git commit -m "feat: add drop-to-replace and click menus to workspace profile/cover"
```

---

### Task 8: WorkspaceDashboard — Profile Reposition Overlay (Drag + Zoom)

**Files:**
- Modify: `src/components/workspaces/WorkspaceDashboard.tsx` (add reposition overlay state + handlers + JSX)

**Interfaces:**
- Consumes: `setImages` with reposition params (Task 2), i18n keys (Task 3)
- Produces: reposition overlay with drag-pan and zoom slider, saves via `setImages`

- [ ] **Step 1: Add reposition state**

Add state variables at the top of `WorkspaceDashboard` (after `const coverInputRef`):

```tsx
const [repositioning, setRepositioning] = useState(false);
const [repos, setRepos] = useState({ x: 0.5, y: 0.5, zoom: 1.0 });
const [dragStart, setDragStart] = useState<{ mx: number; my: number; x: number; y: number } | null>(null);
const imgRef = useRef<HTMLImageElement>(null);
```

- [ ] **Step 2: Add reposition handlers**

Add functions before `return`:

```tsx
function openReposition() {
  if (!workspace) return;
  setRepos({
    x: workspace.profile_image_x,
    y: workspace.profile_image_y,
    zoom: workspace.profile_image_zoom,
  });
  setRepositioning(true);
}

function closeReposition() {
  setRepositioning(false);
  setDragStart(null);
}

async function saveReposition() {
  if (!workspace) return;
  await setImages(
    workspace.id,
    workspace.profile_image,
    workspace.cover_image,
    repos.x,
    repos.y,
    repos.zoom,
    workspace.cover_image_x,
    workspace.cover_image_y,
  );
  setRepositioning(false);
  setDragStart(null);
}

function minZoom(img: HTMLImageElement | null): number {
  if (!img) return 1.0;
  const d = 256; // circle diameter in px (size-64 overlay)
  return d / Math.min(img.naturalWidth, img.naturalHeight);
}
```

- [ ] **Step 3: Wire reposition menu item**

Update the reposition menu item in the profile DropdownMenu (inserted in Task 7). Change:

```tsx
              <DropdownMenuItem
                onClick={() => {
                  /* Opens reposition overlay — handled in Task 8 */
                }}
              >
```

To:

```tsx
              <DropdownMenuItem onClick={openReposition}>
```

- [ ] **Step 4: Add reposition overlay JSX**

Add the overlay just before the closing `</div>` of the component's root return (before `</div>` at line 299):

```tsx
      {/* Profile image reposition overlay */}
      {repositioning && (
        <div
          className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            // Close if clicking the backdrop (not the image or controls)
            if (e.target === e.currentTarget) closeReposition();
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <div
              className="relative size-64 overflow-hidden rounded-full border-4 border-white/30"
              onMouseDown={(e) => {
                if (!imgRef.current) return;
                const rect = imgRef.current.getBoundingClientRect();
                setDragStart({
                  mx: e.clientX,
                  my: e.clientY,
                  x: repos.x,
                  y: repos.y,
                });
                e.preventDefault();
              }}
              onMouseMove={(e) => {
                if (!dragStart || !imgRef.current) return;
                const rect = imgRef.current.getBoundingClientRect();
                const dx = (e.clientX - dragStart.mx) / rect.width;
                const dy = (e.clientY - dragStart.my) / rect.height;
                setRepos((r) => ({
                  ...r,
                  x: Math.max(0, Math.min(1, dragStart.x - dx)),
                  y: Math.max(0, Math.min(1, dragStart.y - dy)),
                }));
              }}
              onMouseUp={() => setDragStart(null)}
              onMouseLeave={() => setDragStart(null)}
            >
              {workspace?.profile_image && (
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${workspace.profile_image}`}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${repos.x * 100}% ${repos.y * 100}%`,
                    transform: `scale(${repos.zoom})`,
                    transformOrigin: "center",
                  }}
                  draggable={false}
                />
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">
                {t("workspace.imageZoom")}
              </span>
              <input
                type="range"
                min={minZoom(imgRef.current)}
                max={3.0}
                step={0.01}
                value={repos.zoom}
                onChange={(e) =>
                  setRepos((r) => ({ ...r, zoom: parseFloat(e.target.value) }))
                }
                className="w-32"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void saveReposition()}>
                {t("common.save")}
              </Button>
              <Button size="sm" variant="outline" onClick={closeReposition}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verify**

```bash
npm run lint
npm run build
```
Expected: no errors. Ensure `common.save` and `common.cancel` i18n keys exist (they're in i18n.ts already).

- [ ] **Step 6: Commit**

```bash
git add src/components/workspaces/WorkspaceDashboard.tsx
git commit -m "feat: add profile image reposition overlay with drag-pan and zoom"
```

---

### Task 9: WorkspaceDashboard — Cover Reposition Drag

**Files:**
- Modify: `src/components/workspaces/WorkspaceDashboard.tsx` (add inline drag state + handlers for cover)

**Interfaces:**
- Consumes: `setImages` with reposition params (Task 2), i18n keys (Task 3)
- Modifies: cover image gets inline drag-to-reposition behavior

- [ ] **Step 1: Add cover reposition state**

Add state at the top of the component (alongside other state vars):

```tsx
const [draggingCover, setDraggingCover] = useState(false);
const [coverDrag, setCoverDrag] = useState<{ mx: number; my: number; x: number; y: number } | null>(null);
const [coverPos, setCoverPos] = useState({ x: 0.5, y: 0.5 });
const coverImgRef = useRef<HTMLImageElement>(null);
```

- [ ] **Step 2: Add cover reposition handlers**

Add functions before the `return`:

```tsx
async function startCoverReposition() {
  if (!workspace) return;
  setCoverPos({
    x: workspace.cover_image_x,
    y: workspace.cover_image_y,
  });
  setDraggingCover(true);
}
```

- [ ] **Step 3: Wire the cover reposition menu item**

Update the reposition menu item in the cover DropdownMenu (inserted in Task 7). Change the empty callback to:

```tsx
              <DropdownMenuItem onClick={startCoverReposition}>
```

- [ ] **Step 4: Update cover image to support drag reposition**

Replace the cover image section within the `draggingCover` conditional. The approach: when cover reposition is active, replace the image area with a draggable version. Since the cover `<img>` is inside the `DropdownMenuTrigger`, we need to render it differently when dragging.

Replace the entire cover banner block (from Task 7) with this version that conditionally renders drag behavior:

```tsx
      {/* Cover image banner */}
      <div className="relative h-32 shrink-0 overflow-hidden rounded-t-lg">
        {draggingCover ? (
          <div
            className="h-full w-full cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => {
              if (!coverImgRef.current) return;
              const rect = coverImgRef.current.getBoundingClientRect();
              setCoverDrag({ mx: e.clientX, my: e.clientY, x: coverPos.x, y: coverPos.y });
              e.preventDefault();
            }}
            onMouseMove={(e) => {
              if (!coverDrag || !coverImgRef.current) return;
              const rect = coverImgRef.current.getBoundingClientRect();
              const dx = (e.clientX - coverDrag.mx) / rect.width;
              const dy = (e.clientY - coverDrag.my) / rect.height;
              setCoverPos({
                x: Math.max(0, Math.min(1, coverDrag.x - dx)),
                y: Math.max(0, Math.min(1, coverDrag.y - dy)),
              });
            }}
            onMouseUp={async () => {
              setCoverDrag(null);
              setDraggingCover(false);
              if (!workspace) return;
              await setImages(
                workspace.id,
                workspace.profile_image,
                workspace.cover_image,
                workspace.profile_image_x,
                workspace.profile_image_y,
                workspace.profile_image_zoom,
                coverPos.x,
                coverPos.y,
              );
            }}
            onMouseLeave={() => setCoverDrag(null)}
          >
            {workspace.cover_image && (
              <img
                ref={coverImgRef}
                src={`data:image/jpeg;base64,${workspace.cover_image}`}
                alt=""
                className="h-full w-full object-cover"
                style={{ objectPosition: `${coverPos.x * 100}% ${coverPos.y * 100}%` }}
                draggable={false}
              />
            )}
          </div>
        ) : (
          /* Drop-to-replace + DropdownMenu trigger (from Task 7) wraps the image */
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div
                className="h-full w-full cursor-pointer"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (!file || !workspace) return;
                  void (async () => {
                    try {
                      const prepared = await prepareImage(file);
                      await setImages(workspace.id, workspace.profile_image, prepared.base64);
                    } catch { /* ignore */ }
                  })();
                }}
              >
                {workspace.cover_image ? (
                  <img
                    src={`data:image/jpeg;base64,${workspace.cover_image}`}
                    alt=""
                    className="h-full w-full object-cover"
                    style={{
                      objectPosition: `${workspace.cover_image_x * 100}% ${workspace.cover_image_y * 100}%`,
                    }}
                  />
                ) : (
                  <div className="from-primary/30 to-primary/10 h-full w-full bg-gradient-to-br" />
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={startCoverReposition}>
                <ImageIcon className="size-3.5" />
                {t("workspace.repositionImage")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => coverInputRef.current?.click()}>
                <ImageIcon className="size-3.5" />
                {t("workspace.replaceImage")}
              </DropdownMenuItem>
              {workspace.cover_image && (
                <DropdownMenuItem onClick={() => void onRemoveCoverImage()}>
                  <X className="size-3.5" />
                  {t("workspace.clearImage")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPickCoverImage(e.target.files)}
        />
      </div>
```

- [ ] **Step 5: Remove unused old cover controls**

Remove the old cover button/X controls (lines 88-108 from the original file) — they're now inside the `DropdownMenu`.

- [ ] **Step 6: Verify**

```bash
npm run lint
npm run build
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspaces/WorkspaceDashboard.tsx
git commit -m "feat: add cover image inline drag reposition"
```

---

### Final Verification

- [ ] **Run full build and lint**

```bash
npm run lint
npm run build
```

Expected: all passes.

- [ ] **Run Rust build**

```bash
cargo build
```

Expected: migration compiles.

- [ ] **Smoke test checklist (manual, after `npm run tauri dev`)**

1. Composer: attach an image, click the chip → menu shows Replace / Clear. Drag a new image from file manager onto the chip → replaces.
2. Canvas: open canvas, attach image, same interactions work.
3. Workspace dashboard: drop an image onto the cover banner → replaces. Click cover → menu with Reposition / Replace / Clear. Choose Reposition → drag to pan, mouse-up saves.
4. Workspace dashboard: drop image onto profile circle → replaces. Click profile → menu. Choose Reposition → overlay opens. Drag to pan, use zoom slider, Save.

---
