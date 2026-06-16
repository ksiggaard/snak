# Icon-rail navigation (activity bar) + zoom

**Date:** 2026-06-16
**Status:** Draft (design) — awaiting user review

## Goal

Replace the horizontal **Chats / Projects / Personas** segmented toggle at the
top of the sidebar with a vertical, fully left-aligned **icon rail** (an
"activity bar" in the VS Code / MS Teams sense). The rail is a data-driven list
so future plugins can contribute entries without touching the core. Alongside
the rail, several chrome items move to better homes and a browser-style **zoom**
feature is added.

Concretely, this change set is:

1. **Icon rail** — vertical, far-left, icon-only with tooltips. Top group =
   section switchers (Chats · Projects · Personas, + a seam for plugin
   entries). Bottom = a **cog "Manage" menu**.
2. **Responsive layout** — three width tiers. At `≥ 600px` the rail + list pane
   + chat are all inline. Below 600px the rail is hidden and the sidebar
   toggle becomes a **3-step cycle** (chat → +sidebar → +rail), with the
   sidebar/rail shown as overlays; the rail layers on top of the sidebar.
3. **Search** moves from the TitleBar's right side to its **left** cluster
   (after the sidebar toggle).
4. **The "⋯" TitleBar menu** is removed; its contents move into a **cog button
   at the lower-left of the rail**, re-iconed as a gear ("Manage" menu).
5. **Theme (light/dark/system)** leaves the menu and moves to
   **Settings › Appearance**.
6. **Zoom** — browser-style zoom in/out/reset with `Ctrl/Cmd +`, `Ctrl/Cmd -`,
   `Ctrl/Cmd 0`, plus zoom controls in the cog menu and matching items in the
   native + in-app menus.

The "New" action (New chat / New project / New persona) moves out of the old
toggle area into a **contextual pane header** at the top of the list pane.

## Key architectural decisions

### A. The rail is a data-driven nav registry, not hardcoded buttons

The rail renders from a typed `SidebarSection[]` list — one entry per section —
keyed by the existing `SidebarMode` (`"chats" | "projects" | "bots"`). This is
the single place to add a section, which is the extensibility the user asked
for. Wiring an actual plugin **category** that contributes rail entries is
deferred (see Out of scope); this wave builds the data-driven seam only,
mirroring how the plugin foundation built the `HostRegistry` seam before
consumers used it.

### B. Responsive nav is a small state machine, not pure CSS

The 3-step toggle and the "rail overlays the sidebar" behavior below 600px need
JS, so the layout store gains a tier-aware model:

- **Persisted (desktop):** `sidebarOpen` (list-pane visibility, default true),
  `sidebarMode` (active section), `sidebarWidth` — all unchanged.
- **Ephemeral (compact):** `compactNav: 0 | 1 | 2` — the narrow-width disclosure
  level. `0` = chat only, `1` = sidebar overlay, `2` = sidebar + rail overlay.
  Not persisted (like today's `mobileOpen` Sheet); recomputed on each
  wide→compact transition.
- **Tier** (`wide` `≥600` / `tablet` `480–599` / `phone` `<480`) is tracked in
  the store via a `matchMedia` listener registered once in `App`.

The single sidebar-toggle action becomes tier-aware:
- **wide** → flips `sidebarOpen` (rail stays; pane shows/hides) — a 2-state toggle.
- **compact** → advances `compactNav` `0→1→2→0` — the 3-step cycle.

Initial `compactNav` when entering compact: `tablet` → `1` (sidebar shown),
`phone` → `0` (chat only). This matches the requested per-tier defaults.

**Breakpoint move:** the sidebar currently keys off Tailwind `md` (768px). The
rail/pane inline visibility moves to a **600px** breakpoint. Other `md:` usages
unrelated to the sidebar (e.g. `SettingsView`'s own nav) are left as-is; the
sidebar-specific ones are audited and switched to the 600px query during
implementation.

### C. Zoom uses real webview zoom (Tauri `setZoom`), scoped to the main window

Zoom calls `getCurrentWebview().setZoom(factor)` — true browser zoom that scales
everything (text, images, spacing), matching "like the web." It is **per-webview**,
so the quick-input overlay (a separate window) is naturally unaffected; the
apply path additionally no-ops when the current window label is `"quick"`.

The factor is persisted in `localStorage` (key `zoom`) and re-applied on `App`
mount (mirroring the theme/appearance bootstrap). A one-frame size pop at
startup is acceptable for zoom (unlike a theme flash).

**Rejected alternative:** CSS `zoom` on `<html>`. Synchronous (no flash) but
applies in whichever window renders the bundle (would need explicit window
gating) and is a less faithful "browser zoom." Webview `setZoom` is the better
fit; the startup pop is the accepted tradeoff. This is **distinct** from the
existing Typography "UI size" setting (which scales only the root font-size).

## Components & changes

### 1. Layout prefs — `src/lib/layout.ts`

- No change to the persisted helpers (`sidebarOpen`, `sidebarWidth`,
  `sidebarMode`) other than the breakpoint constants below.
- Add a tier type + breakpoint constants:
  - `export type LayoutTier = "wide" | "tablet" | "phone"`
  - `RAIL_BREAKPOINT = 600`, `PHONE_BREAKPOINT = 480` (px).
  - `tierForWidth(px): LayoutTier` — pure, unit-tested.
  - `initialCompactNav(tier): 0 | 1` — `tablet → 1`, `phone → 0`, `wide → 0`
    (compactNav is only meaningful in compact). Pure, unit-tested.

### 2. Layout store — `src/store/layout.ts`

- Replace `mobileOpen: boolean` (+ `setMobileOpen`) with:
  - `compactNav: 0 | 1 | 2` (ephemeral; initial value derived from the tier at
    store creation via `tierForWidth(window.innerWidth)` → `initialCompactNav`).
  - `tier: LayoutTier` (seeded from `tierForWidth(window.innerWidth)`).
  - `setTier(tier)` — when the tier changes into compact from wide, reset
    `compactNav` to `initialCompactNav(tier)`; entering wide leaves it (ignored).
  - `cycleCompactNav()` — `0→1→2→0`.
  - `setCompactNav(n)` — explicit set (used by scrim/Esc/selection → `0`).
- Make `toggleSidebar()` tier-aware: `tier === "wide"` → flip `sidebarOpen`
  (persisted as today); else → `cycleCompactNav()`.
- `App` registers a single `matchMedia` (or resize) listener that calls
  `setTier(tierForWidth(...))`.

### 3. New: icon rail — `src/components/sidebar/SidebarRail.tsx`

- Renders a `SidebarSection[]` list:
  ```ts
  interface SidebarSection { id: SidebarMode; labelKey: MessageKey; Icon: LucideIcon }
  const SECTIONS: SidebarSection[] = [
    { id: "chats",    labelKey: "sidebar.chats",    Icon: MessagesSquare },
    { id: "projects", labelKey: "sidebar.projects", Icon: Folder },
    { id: "bots",     labelKey: "sidebar.bots",     Icon: Bot },
  ];
  ```
  (Tooltips/aria reuse the existing `sidebar.chats/projects/bots` keys — no new
  section strings.)
- Each entry: icon-only button (~36px) in a ~50px-wide rail, wrapped in a
  `Tooltip` (label on the right). Active section (`sidebarMode === id`) gets the
  filled background + a left accent bar (the established active-indicator look).
- Clicking a section does what today's `SidebarModeSwitch` does — `setSidebarMode(id)`
  — **plus** ensure the list pane is visible: in wide, set `sidebarOpen` true; in
  compact, bump `compactNav` to at least `1`. It does **not** close an open
  project/bot or clear search (the mode switch never did; that stays the job of
  the "New" actions).
- Bottom of the rail (pushed down with `flex-1` spacer): the **cog "Manage"
  menu** (section 4).
- A `variant?: "inline" | "overlay"` prop adjusts shadow/z for the compact
  overlay; behavior is identical.

### 4. New: cog "Manage" menu — in `SidebarRail.tsx` (or `SidebarRailMenu.tsx`)

A `DropdownMenu` triggered by a gear button at the rail bottom (`align="end"`,
`side="right"` so it opens away from the rail). Contents — relocated from the
old TitleBar "⋯" menu, minus theme, plus zoom:

- **Settings…** → `runMenuAction("settings")`, shortcut `⌘,`
- **Usage** → `runMenuAction("usage")`, shortcut `⌘U`
- separator
- **Zoom** row: `−` button (`zoom-out`), the current `Math.round(zoom*100)%`
  readout, `+` button (`zoom-in`), and a **Reset** affordance (`zoom-reset`,
  `⌘0`). Implemented as a non-closing custom row inside the menu.
- separator
- **Work offline** — the existing `DropdownMenuCheckboxItem` bound to
  `forceOffline` (moved verbatim).

Reuses existing i18n keys `titleBar.settings`, `titleBar.usage`,
`titleBar.workOffline`. New aria/label key `rail.manage` ("Manage").

### 5. Rename/split sidebar content — `src/components/sidebar/`

- **Delete `SidebarModeSwitch.tsx`** (replaced by the rail).
- **`SidebarPane.tsx`** (extracted from today's `SidebarContent`): a **pane
  header** + the active list pane.
  - Pane header: the active section's title (`sidebar.chats/projects/bots`) on
    the left; contextual **New** actions on the right as icon buttons with
    tooltips:
    - chats → New chat (`Plus`) + New incognito (`Ghost`)
    - projects → New project (`FolderPlus`)
    - bots → New persona (`Bot`)
  - The `onNewChat / onNewProject / onNewBot` handlers move here unchanged.
  - Body: `ChatsPane` / `ProjectsPane` / `BotsPane` by `sidebarMode` (unchanged).
- **`Sidebar.tsx`** (wide inline wrapper): the resizable `<aside>` now renders
  `<SidebarPane />` + `<SidebarResizeHandle />`. Visibility keys off
  `tier === "wide" && sidebarOpen`.

### 6. App layout — `src/App.tsx`

- Inline row (wide): `[<SidebarRail /> (when tier === "wide")] [<Sidebar /> (when
  wide && sidebarOpen)] [<main>]`. The rail is **always** present at wide widths,
  independent of `sidebarOpen`.
- Compact overlay: replace the single `mobileOpen` `Sheet` with a left overlay
  driven by `compactNav`:
  - `compactNav >= 1` → render `<SidebarPane />` in a left overlay (Sheet).
  - `compactNav === 2` → also render `<SidebarRail variant="overlay" />` layered
    **on top of** the pane at the far left (higher z + shadow).
  - Scrim click / Esc → `setCompactNav(0)` (via the Sheet's `onOpenChange`,
    matching today's `mobileOpen` close behavior).
  - Offsets below the chrome stay as today (TitleBar 32 + inline MenuBar 28).
- Register the `matchMedia`/resize → `setTier` listener in the mount effect.
- Add zoom bootstrap: `applyZoom(getStoredZoom())` (guarded to the main window).

### 7. TitleBar — `src/components/TitleBar.tsx`

- **Move Search** into the left cluster: after the desktop sidebar toggle,
  before the drag-region spacer. Same `runMenuAction("search")` + tooltip.
- **Remove** the entire `DropdownMenu` ("⋯" / `MoreVertical`) block (Settings,
  Usage, Work offline, Theme) — relocated to the cog menu (settings/usage/offline)
  and Appearance (theme).
- The **offline badge** (shown only when offline) stays in the TitleBar.
- The sidebar-toggle button stays top-left; its `onClick` already routes through
  `toggleSidebar()`, which is now tier-aware. Its icon may reflect the compact
  cycle state (detail; keep `PanelLeft`/`PanelLeftClose` for wide).

### 8. Theme → Appearance — `src/components/settings/Appearance.tsx`

- Add a `ThemeCard` at the **top** of the `Appearance()` card list. A 3-way
  `ToggleGroup` (System / Light / Dark) bound to `useTheme` (`theme` /
  `setTheme`) — same store the removed TitleBar radio used.
- New i18n keys `appearance.theme.title`, `appearance.theme.description`,
  `appearance.theme.system`, `appearance.theme.light`, `appearance.theme.dark`.
- The now-unused `titleBar.theme*` keys are removed from `en` + all bundled packs
  (cleanup; the locales test enforces parity).

### 9. New: zoom lib — `src/lib/zoom.ts`

- `ZOOM_MIN = 0.5`, `ZOOM_MAX = 2.0`, `ZOOM_STEP = 0.1`, `ZOOM_DEFAULT = 1.0`.
- `clampZoom(z): number` — clamp to `[MIN, MAX]`, snap to one decimal; non-finite
  → `DEFAULT`.
- `getStoredZoom(): number` — localStorage `zoom`; absent/garbage → `DEFAULT`.
- `storeZoom(z)`: `z === DEFAULT` → remove key; else store the clamped value.
- `applyZoom(z)`: no-op when `getCurrentWindow().label === "quick"`; else
  `void getCurrentWebview().setZoom(clampZoom(z))`.
- All pure functions unit-tested.

### 10. New: zoom store — `src/store/zoom.ts`

Mirrors `store/theme.ts`:
- State `zoom: number` seeded from `getStoredZoom()`.
- `setZoom(z)`: `const v = clampZoom(z)` → `storeZoom(v)` → `applyZoom(v)` →
  `set({ zoom: v })`.
- `zoomIn()` = `setZoom(zoom + ZOOM_STEP)`; `zoomOut()` = `setZoom(zoom - STEP)`;
  `resetZoom()` = `setZoom(ZOOM_DEFAULT)`.
- (Apply on startup is done from `App`'s mount effect, not module load, to avoid
  webview-readiness timing issues.)

### 11. Shortcuts + actions — `src/lib/menuActions.ts`

- Extend `MenuAction` with `"zoom-in" | "zoom-out" | "zoom-reset"`.
- `menuActionForKey`: match the zoom keys **before** the `e.shiftKey` early
  return (so `Ctrl/Cmd +`, which is `Shift+=` on US layouts, is caught):
  - zoom-in: `e.key === "+"` or `"="` (also `e.code === "NumpadAdd"`)
  - zoom-out: `e.key === "-"` (also `"NumpadSubtract"`)
  - zoom-reset: `e.key === "0"` (also `"Numpad0"`)
- `runMenuAction`: add cases → `useZoom.getState().zoomIn/zoomOut/resetZoom()`.
- `shortcutLabel` already renders arbitrary strings; the menus pass `"+"`, `"-"`,
  `"0"`.

### 12. In-app menu bar — `src/components/MenuBar.tsx`

- Under **View**, after Usage (separator), add: Zoom In (`+`), Zoom Out (`-`),
  Reset Zoom (`0`) via the existing `Item` component. New i18n keys
  `menu.zoomIn`, `menu.zoomOut`, `menu.resetZoom`.

### 13. Native menu — `src-tauri/src/menu.rs`

- Add three `MenuItem`s to the **View** submenu: `menu_zoom_in`
  (`CmdOrCtrl+Plus`), `menu_zoom_out` (`CmdOrCtrl+-`), `menu_zoom_reset`
  (`CmdOrCtrl+0`).
- `on_menu_event`: map those ids → `"zoom-in" / "zoom-out" / "zoom-reset"`, then
  the existing `show_main` + emit `app-menu` (the webview applies the zoom via
  `runMenuAction`, keeping zoom logic frontend-side).
- Accelerator strings (esp. `Plus`) are verified during implementation; the
  webview keydown handler is the primary path, native accelerators secondary.

### 14. Capabilities — `src-tauri/capabilities/default.json`

- Add `"core:webview:allow-set-webview-zoom"` so the JS `setZoom` call is
  permitted. Confirm `tauri.conf.json` does not also enable built-in
  `zoomHotkeysEnabled` (avoid double-handling Ctrl+/-).

### 15. i18n — `src/lib/i18n.ts` + bundled packs

Add to `en` **and** translate into all five bundled packs
(`src/locales/{de,fr,pl,es,da}.json`) — the locales test forbids relying on
fallback for bundled packs:

- `rail.manage`: "Manage"
- `appearance.theme.title`: "Theme"
- `appearance.theme.description`: "Light, dark, or follow the system."
- `appearance.theme.system` / `.light` / `.dark`: "System" / "Light" / "Dark"
- `menu.zoomIn`: "Zoom In"
- `menu.zoomOut`: "Zoom Out"
- `menu.resetZoom`: "Reset Zoom"

Remove `titleBar.theme`, `titleBar.themeSystem`, `titleBar.themeLight`,
`titleBar.themeDark` from `en` + all packs.

### 16. Tests

- `src/lib/zoom.test.ts` (TDD): `clampZoom` (range, snap, non-finite),
  `getStoredZoom` (absent/garbage → default; in-range round-trip),
  `storeZoom` (default removes key; round-trips a value).
- `src/lib/layout.test.ts` (extend): `tierForWidth` boundaries (479/480/599/600),
  `initialCompactNav` per tier, and `cycleCompactNav` sequence `0→1→2→0` via the
  store.
- `src/lib/menuActions` zoom-key mapping (`menuActionForKey` for
  `+`/`=`/`-`/`0`, including the shift case) — add to the existing menuActions
  test if present, else a new `menuActions.test.ts`.

## Out of scope (YAGNI)

- A plugin **category** that contributes rail entries — only the data-driven
  `SidebarSection[]` seam is built now; plugin contribution is a later wave.
- Persisting `compactNav` across reloads (ephemeral by design).
- User reordering / pinning / hiding rail icons.
- Per-section pane-width memory.
- Pinch / Ctrl+scroll zoom (keyboard + menu + cog row only).
- Remembering a custom zoom per window/thread.

## Risk / interaction notes

- **Breakpoint migration (768 → 600):** audit every sidebar-tied `md:` class
  (e.g. `Sidebar`'s `md:flex`, the TitleBar mobile hamburger's `md:hidden`,
  desktop toggle's `md:flex`) and switch to the 600px query/tier. Non-sidebar
  `md:` usage (SettingsView nav, ChatView) is independent and untouched.
- **macOS traffic lights:** the rail sits **below** the full-width TitleBar
  (32px), so it never collides with the window controls / drag region.
- **`+` vs `=`:** zoom-in must be matched before the existing `shiftKey` guard in
  `menuActionForKey`, or `Ctrl+Shift+=` ("+") is dropped.
- **setZoom timing/flash:** applied on `App` mount; a brief one-frame size pop is
  accepted. Requires the new capability permission.
- **Quick overlay:** a separate window — must not get the rail, the zoom, or the
  compact overlay (guarded by window label / the `quick` route in `main.tsx`).
- **Compact overlay layering:** "rail on top of the sidebar" is two stacked left
  overlays (rail above pane). The exact visual layering is validated on a narrow
  window during implementation.

## Open decision flagged for review

- **Rail labels:** the approved mockup showed tiny text labels under each icon.
  This spec specifies **icon-only with hover/focus tooltips** instead, because a
  ~50px rail is too narrow to legibly fit "Projects" / "Personas", it matches the
  cited VS Code / Teams references, and it scales as plugins add entries. If you
  prefer visible labels, the rail widens (~64–72px) and shows a label line under
  each icon — easy to switch.
