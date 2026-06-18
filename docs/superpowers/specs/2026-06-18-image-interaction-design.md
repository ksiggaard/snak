# Image Drag-to-Replace and Click-for-Menu on Uploadable Images

## Scope

Enhance every surface where users upload images so they can:
- **Drag a new image file onto the existing image** to replace it
- **Click the image** to open a context menu with contextual actions

Three surfaces are affected:

| Surface | Menu items | Drop-to-replace | Reposition behavior |
|---------|-----------|-----------------|-------------------|
| Composer attachment chip | Replace, Clear | Yes | N/A |
| Canvas footer chip | Replace, Clear | Yes | N/A |
| Workspace profile (circle) | Reposition, Replace, Clear | Yes | Drag-pan + zoom slider |
| Workspace cover (banner) | Reposition, Replace, Clear | Yes | Drag-pan |

## New Component: `ImageChip`

`src/components/chat/ImageChip.tsx` — reusable chip for composer and canvas.

```
Props:
  image: PreparedImage
  index: number
  onRemove: (index: number) => void
  onReplace: (index: number, image: PreparedImage) => void
```

### Behaviors

- **Render:** 64x64 thumbnail, `object-cover`, `rounded-md` (same as current markup)
- **Drop-to-replace:** `onDragOver` (preventDefault + highlight ring) -> `onDrop` reads
  first file, runs `prepareImage()`, calls `onReplace(index, prepared)`.
  Non-image drops silently ignored.
- **Click-for-menu:** shadcn `DropdownMenu` with two items:
  - **Replace** -> clicks hidden `<input type="file" accept="image/*">` via ref
  - **Clear** -> calls `onRemove(index)`
- **Reposition:** Not applicable for chips (removed from menu per user decision).

### Consumers

- `Composer.tsx` — replaces inline thumbnail markup (lines 711-727). Passes
  `removeImage`, new `replaceImage` callback.
- `Canvas.tsx` — replaces inline thumbnail markup (lines 128-144). Receives
  `onReplaceImage` from Composer via props, delegates to it.

Both consumers keep their own hidden file inputs (one per chip via ref) for the
Replace action.

## Workspace Profile Image Reposition

### Interaction

Clicking the profile circle -> *Reposition* opens a reposition overlay:

- Full image visible behind a circular mask (matching the dashboard render size)
- **Drag** to pan: tracks `onMouseDown` -> `onMouseMove` delta, updates x/y offsets
  (clamped 0-1 range, mapping to `object-position` percentages)
- **Zoom slider** in lower-right corner: `<input type="range">` controlling scale
  factor. Min = `circleDiameter / min(imageNaturalWidth, imageNaturalHeight)`
  (image always covers the circle). Max = 3.0. Step = 0.01.
- **Save** commits offsets + zoom to DB, closes overlay.
- **Cancel** reverts to previous values.

### Rendering

The profile `<img>` in `WorkspaceDashboard` applies:

```css
object-fit: cover;
object-position: ${x * 100}% ${y * 100}%;
transform: scale(${zoom});
transform-origin: center;
```

### State

Three new columns on `workspaces` (defaults ensure existing rows render centered):

- `profile_image_x REAL NOT NULL DEFAULT 0.5`
- `profile_image_y REAL NOT NULL DEFAULT 0.5`
- `profile_image_zoom REAL NOT NULL DEFAULT 1.0`

When the image is cleared (`profile_image = NULL`), offset/zoom are ignored.
When a new image is set, offsets reset to 0.5/0.5 and zoom to 1.0.

## Workspace Cover Image Reposition

### Interaction

Clicking the cover banner -> *Reposition* enters inline drag mode:

- Cursor changes to `grab` (idle) / `grabbing` (dragging)
- `onMouseDown` starts drag session; `onMouseMove` updates x/y offsets
- `onMouseUp` commits to DB

No zoom -- the cover image always uses `object-fit: cover` at scale 1.

### State

Two new columns:

- `cover_image_x REAL NOT NULL DEFAULT 0.5`
- `cover_image_y REAL NOT NULL DEFAULT 0.5`

Same reset-on-clear / reset-on-new-image logic as profile.

## Drop-to-Replace on Workspace Images

Both profile circle and cover banner gain `onDragOver` + `onDrop` handlers:

- Visual feedback during drag-over: semi-transparent overlay + dashed border
- On drop: `prepareImage(file)` -> `setImages(id, ..., ...)` with new base64,
  resetting offsets to defaults (new image, new dimensions)
- Non-image / multiple files: only first image file is used, rest ignored

## Click-for-Menu on Workspace Images

Both surfaces use shadcn `DropdownMenu` triggered by click:

| Menu item | Profile | Cover |
|-----------|---------|-------|
| Reposition | Opens overlay with drag + zoom | Enters inline drag mode |
| Replace | Clicks hidden file input | Clicks hidden file input |
| Clear | Calls `setImages(id, null, cover_image)` | Calls `setImages(id, profile_image, null)` |

## Database Migration

`src-tauri/migrations/027_image_position.sql`:

```sql
ALTER TABLE workspaces ADD COLUMN profile_image_x REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN profile_image_y REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN profile_image_zoom REAL NOT NULL DEFAULT 1.0;
ALTER TABLE workspaces ADD COLUMN cover_image_x REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN cover_image_y REAL NOT NULL DEFAULT 0.5;
```

## Store & DB Changes

- `src/types/db.ts`: Add `profile_image_x`, `profile_image_y`, `profile_image_zoom`,
  `cover_image_x`, `cover_image_y` to `Workspace` interface
- `src/lib/db.ts`: Extend `setWorkspaceImages()` to accept and persist the 5 new
  columns; `listWorkspaces()` already selects `*` so no query change needed
- `src/store/workspaces.ts`: Extend `setImages` action signature with optional
  reposition params; `refresh()` picks up new columns automatically

## i18n Keys

New keys (`src/lib/i18n.ts` en + all locale files):

```
composer.replaceImage      -> "Replace image"
composer.clearImage        -> "Clear image"
workspace.repositionImage  -> "Reposition"
workspace.replaceImage     -> "Replace image"
workspace.clearImage       -> "Clear image"
workspace.imageZoom        -> "Zoom"
```

Existing keys reused: `composer.removeImage`, `workspace.removeCoverImage`,
`workspace.changeCoverImage`, `workspace.coverImage`.

## Edge Cases

1. **Reposition with no image:** Offsets ignored. Setting a new image resets to defaults.
2. **Zoom below cover:** Min zoom formula ensures circle is always covered.
3. **Multiple files dropped:** Only first file processed per surface.
4. **Non-image drop:** Silently ignored (same `classifyFile` gate as existing attach).
5. **Canvas pass-through:** Canvas receives `onReplaceImage` prop from Composer,
   forwards to `ImageChip`.
6. **Existing workspaces:** Migration defaults to centered/no-zoom -- no visual change.
7. **Touch:** Not handled (desktop-only Tauri app).

## Files Touched

| File | Change |
|------|--------|
| `src/components/chat/ImageChip.tsx` | **New** -- reusable chip component |
| `src/components/chat/Composer.tsx` | Use ImageChip; add replaceImage callback |
| `src/components/chat/Canvas.tsx` | Use ImageChip; accept onReplaceImage prop |
| `src/components/workspaces/WorkspaceDashboard.tsx` | Drop-to-replace, click menus, reposition overlay for profile, reposition drag for cover |
| `src/types/db.ts` | Add reposition columns to Workspace type |
| `src/lib/db.ts` | Extend setWorkspaceImages signature |
| `src/store/workspaces.ts` | Extend setImages action |
| `src/lib/image.ts` | No change (reused as-is) |
| `src/lib/i18n.ts` | New keys |
| `src/locales/*.json` | Translation entries |
| `src-tauri/migrations/027_image_position.sql` | **New** |
| `src-tauri/src/lib.rs` | Register migration 027 |
