# Icon-rail navigation (activity bar) + zoom — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the horizontal Chats/Projects/Personas toggle with a vertical, left-aligned icon rail (VS Code / MS Teams style), make the nav responsive (3 tiers + a 3-step compact toggle), relocate Search and the "⋯" menu, move Theme into Appearance, and add browser-style zoom.

**Architecture:** The rail renders from a data-driven `SidebarSection[]` (extensible for future plugins). Responsive behavior is a small state machine in the layout store (`tier` + ephemeral `compactNav`). Zoom uses Tauri's per-webview `setZoom`, persisted in localStorage and re-applied on mount, with `Ctrl/Cmd +/-/0` shortcuts wired through the existing `menuActions` seam into the native + in-app menus.

**Tech Stack:** Tauri v2, React 19, TypeScript, Zustand, Tailwind v4, shadcn/ui, lucide-react, vitest, Rust (muda menus).

**Spec:** `docs/superpowers/specs/2026-06-16-icon-rail-navigation-design.md`

---

## Notes for the implementer

- Run frontend commands from the repo root; Rust commands from `src-tauri/`.
- `MessageKey` is derived from the `en` catalog in `src/lib/i18n.ts`, so **any new `t("…")` key must be added to that catalog first** or `tsc` fails. Bundled packs (`src/locales/{de,fr,pl,es,da}.json`) must translate **every** catalog key (enforced by `src/lib/locales.test.ts`) — so add to the catalog and all 5 packs together, and remove from all 6 together. `en.json` is a thin pack (`strings: {}`) — never add strings to it.
- Entries in the `en` object and in each pack's `strings` object are order-independent — insert near related keys for a clean diff; correctness doesn't depend on position.
- Verify the full suite at the end: `npm run build` (tsc + vite), `npm run lint`, `npx vitest run`, and `cargo build` + `cargo clippy` in `src-tauri/`.
- Commit messages: do **not** add any `Co-Authored-By` trailer.

---

## Task 1: Add all new i18n keys (catalog + 5 packs)

**Files:**
- Modify: `src/lib/i18n.ts` (the `en` catalog object)
- Modify: `src/locales/de.json`, `src/locales/fr.json`, `src/locales/pl.json`, `src/locales/es.json`, `src/locales/da.json` (each one's `strings` object)
- Test: `src/lib/locales.test.ts` (existing — run it, don't edit)

- [ ] **Step 1: Add the new keys to the `en` catalog**

In `src/lib/i18n.ts`, add these entries anywhere inside the `export const en = { … }` object (suggested: `rail.*`/`manage.*` near the `sidebar.*` block, `appearance.theme.*` near other `appearance.*` keys, `menu.zoom*` near `menu.usage`):

```ts
  "rail.manage": "Manage",
  "manage.zoom": "Zoom",
  "appearance.theme.title": "Theme",
  "appearance.theme.description": "Light, dark, or follow the system.",
  "appearance.theme.system": "System",
  "appearance.theme.light": "Light",
  "appearance.theme.dark": "Dark",
  "menu.zoomIn": "Zoom In",
  "menu.zoomOut": "Zoom Out",
  "menu.resetZoom": "Reset Zoom",
```

- [ ] **Step 2: Translate the keys into all 5 bundled packs**

Add to each pack's `strings` object:

`src/locales/de.json`:
```json
    "rail.manage": "Verwalten",
    "manage.zoom": "Zoom",
    "appearance.theme.title": "Design",
    "appearance.theme.description": "Hell, dunkel oder dem System folgen.",
    "appearance.theme.system": "System",
    "appearance.theme.light": "Hell",
    "appearance.theme.dark": "Dunkel",
    "menu.zoomIn": "Vergrößern",
    "menu.zoomOut": "Verkleinern",
    "menu.resetZoom": "Zoom zurücksetzen",
```

`src/locales/fr.json`:
```json
    "rail.manage": "Gérer",
    "manage.zoom": "Zoom",
    "appearance.theme.title": "Thème",
    "appearance.theme.description": "Clair, sombre ou suivre le système.",
    "appearance.theme.system": "Système",
    "appearance.theme.light": "Clair",
    "appearance.theme.dark": "Sombre",
    "menu.zoomIn": "Zoom avant",
    "menu.zoomOut": "Zoom arrière",
    "menu.resetZoom": "Réinitialiser le zoom",
```

`src/locales/pl.json`:
```json
    "rail.manage": "Zarządzaj",
    "manage.zoom": "Powiększenie",
    "appearance.theme.title": "Motyw",
    "appearance.theme.description": "Jasny, ciemny lub zgodny z systemem.",
    "appearance.theme.system": "System",
    "appearance.theme.light": "Jasny",
    "appearance.theme.dark": "Ciemny",
    "menu.zoomIn": "Powiększ",
    "menu.zoomOut": "Pomniejsz",
    "menu.resetZoom": "Resetuj powiększenie",
```

`src/locales/es.json`:
```json
    "rail.manage": "Administrar",
    "manage.zoom": "Zoom",
    "appearance.theme.title": "Tema",
    "appearance.theme.description": "Claro, oscuro o seguir el sistema.",
    "appearance.theme.system": "Sistema",
    "appearance.theme.light": "Claro",
    "appearance.theme.dark": "Oscuro",
    "menu.zoomIn": "Acercar",
    "menu.zoomOut": "Alejar",
    "menu.resetZoom": "Restablecer zoom",
```

`src/locales/da.json`:
```json
    "rail.manage": "Administrér",
    "manage.zoom": "Zoom",
    "appearance.theme.title": "Tema",
    "appearance.theme.description": "Lyst, mørkt eller følg systemet.",
    "appearance.theme.system": "System",
    "appearance.theme.light": "Lyst",
    "appearance.theme.dark": "Mørkt",
    "menu.zoomIn": "Zoom ind",
    "menu.zoomOut": "Zoom ud",
    "menu.resetZoom": "Nulstil zoom",
```

(Each `strings` object already has entries — append these before the closing `}`, ensuring commas are valid JSON.)

- [ ] **Step 3: Run the locales + i18n tests**

Run: `npx vitest run src/lib/locales.test.ts src/lib/i18n.test.ts`
Expected: PASS (every translated pack covers the new catalog keys; no unknown keys).

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: PASS (no tsc errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.ts src/locales/*.json
git commit -m "i18n: add rail/manage/theme/zoom strings to catalog + bundled packs"
```

---

## Task 2: Zoom storage lib (pure functions, TDD)

**Files:**
- Create: `src/lib/zoom.ts`
- Test: `src/lib/zoom.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/zoom.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  clampZoom,
  getStoredZoom,
  storeZoom,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT,
} from "@/lib/zoom";

beforeEach(() => {
  localStorage.clear();
});

describe("clampZoom", () => {
  it("keeps an in-range value, snapped to one decimal", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(1.23)).toBe(1.2);
    expect(clampZoom(1.25)).toBe(1.3);
  });

  it("clamps below MIN and above MAX", () => {
    expect(clampZoom(ZOOM_MIN - 1)).toBe(ZOOM_MIN);
    expect(clampZoom(ZOOM_MAX + 1)).toBe(ZOOM_MAX);
  });

  it("falls back to default for non-finite input", () => {
    expect(clampZoom(NaN)).toBe(ZOOM_DEFAULT);
    expect(clampZoom(Infinity)).toBe(ZOOM_DEFAULT);
  });
});

describe("zoom persistence", () => {
  it("defaults to ZOOM_DEFAULT when nothing is stored", () => {
    expect(getStoredZoom()).toBe(ZOOM_DEFAULT);
  });

  it("falls back to default for a corrupt stored value", () => {
    localStorage.setItem("zoom", "not-a-number");
    expect(getStoredZoom()).toBe(ZOOM_DEFAULT);
  });

  it("round-trips a stored value", () => {
    storeZoom(1.5);
    expect(getStoredZoom()).toBe(1.5);
  });

  it("removes the key when storing the default", () => {
    storeZoom(1.5);
    storeZoom(ZOOM_DEFAULT);
    expect(localStorage.getItem("zoom")).toBeNull();
    expect(getStoredZoom()).toBe(ZOOM_DEFAULT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/zoom.test.ts`
Expected: FAIL (cannot resolve `@/lib/zoom`).

- [ ] **Step 3: Write the implementation**

Create `src/lib/zoom.ts`:

```ts
// Browser-style page zoom (Ctrl/Cmd +/-/0). Like the theme/layout prefs this is
// a per-device UI concern read synchronously at startup, so it lives in
// localStorage (not the SQLite settings table). Distinct from the Typography
// "UI size" setting: zoom scales the whole webview (text, images, spacing) via
// Tauri's per-webview setZoom, not just the root font-size.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

const KEY = "zoom";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1.0;

/** Clamp to [MIN, MAX] and snap to one decimal; non-finite → default. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT;
  const snapped = Math.round(z * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

export function getStoredZoom(): number {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return ZOOM_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clampZoom(n) : ZOOM_DEFAULT;
}

export function storeZoom(z: number): void {
  const v = clampZoom(z);
  if (v === ZOOM_DEFAULT) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, String(v));
}

/** Apply the zoom to the current webview. No-op in the quick-input overlay
 *  (a separate window that must stay at 100%). */
export function applyZoom(z: number): void {
  if (getCurrentWindow().label === "quick") return;
  void getCurrentWebview().setZoom(clampZoom(z));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/zoom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zoom.ts src/lib/zoom.test.ts
git commit -m "feat(zoom): add zoom storage lib (clamp/get/store/apply)"
```

---

## Task 3: Zoom store

**Files:**
- Create: `src/store/zoom.ts`

- [ ] **Step 1: Write the store**

Create `src/store/zoom.ts` (mirrors `src/store/theme.ts`):

```ts
import { create } from "zustand";
import {
  applyZoom,
  clampZoom,
  getStoredZoom,
  storeZoom,
  ZOOM_DEFAULT,
  ZOOM_STEP,
} from "@/lib/zoom";

interface ZoomState {
  /** Webview zoom factor (1 = 100%). */
  zoom: number;
  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export const useZoom = create<ZoomState>((set, get) => ({
  zoom: getStoredZoom(),

  setZoom: (z) => {
    const v = clampZoom(z);
    storeZoom(v);
    applyZoom(v);
    set({ zoom: v });
  },

  zoomIn: () => get().setZoom(get().zoom + ZOOM_STEP),
  zoomOut: () => get().setZoom(get().zoom - ZOOM_STEP),
  resetZoom: () => get().setZoom(ZOOM_DEFAULT),
}));
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/store/zoom.ts
git commit -m "feat(zoom): add zoom store (set/in/out/reset)"
```

---

## Task 4: Permission + apply zoom on startup

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the webview-zoom permission**

In `src-tauri/capabilities/default.json`, add `"core:webview:allow-set-webview-zoom"` to the `permissions` array (e.g. after `"core:window:allow-set-decorations"`):

```json
    "core:window:allow-set-decorations",
    "core:webview:allow-set-webview-zoom",
```

- [ ] **Step 2: Apply stored zoom on App mount**

In `src/App.tsx`, add an import near the other store imports:

```ts
import { useZoom } from "@/store/zoom";
```

Inside the `App()` component, near the other store hooks, add:

```ts
  const applyStoredZoom = () => useZoom.getState().setZoom(useZoom.getState().zoom);
```

Then in the main mount `useEffect` (the one calling `void init()`, `void initProjects()`, …), add a call so the persisted zoom is applied once the webview is ready:

```ts
    // Re-apply the persisted webview zoom (browser-style Ctrl/Cmd +/-/0).
    applyStoredZoom();
```

(Calling `setZoom(zoom)` re-stores the same value and applies it via `applyZoom`. Leave the effect's dependency array as-is — `applyStoredZoom` reads from the store imperatively.)

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual check (optional but recommended)**

Run: `npm run tauri dev`, then confirm the app still launches without permission errors in the console. (Zoom shortcuts come in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/capabilities/default.json src/App.tsx
git commit -m "feat(zoom): grant set-webview-zoom permission and apply on startup"
```

---

## Task 5: Zoom actions + keyboard shortcuts (TDD)

**Files:**
- Modify: `src/lib/menuActions.ts`
- Test: `src/lib/menuActions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/menuActions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { menuActionForKey } from "@/lib/menuActions";

// In jsdom, isMac is false (userAgent has no "Mac OS X"), so the modifier is
// Ctrl. These tests therefore use ctrlKey.
function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("menuActionForKey — zoom", () => {
  it("maps Ctrl+= and Ctrl++ to zoom-in", () => {
    expect(menuActionForKey(key({ key: "=", ctrlKey: true }))).toBe("zoom-in");
    expect(menuActionForKey(key({ key: "+", ctrlKey: true, shiftKey: true }))).toBe(
      "zoom-in",
    );
  });

  it("maps Ctrl+- to zoom-out and Ctrl+0 to zoom-reset", () => {
    expect(menuActionForKey(key({ key: "-", ctrlKey: true }))).toBe("zoom-out");
    expect(menuActionForKey(key({ key: "0", ctrlKey: true }))).toBe("zoom-reset");
  });

  it("ignores the zoom keys without the modifier", () => {
    expect(menuActionForKey(key({ key: "=" }))).toBeNull();
    expect(menuActionForKey(key({ key: "0" }))).toBeNull();
  });

  it("still maps the existing letter shortcuts", () => {
    expect(menuActionForKey(key({ key: "n", ctrlKey: true }))).toBe("new-chat");
    expect(menuActionForKey(key({ key: "k", ctrlKey: true }))).toBe("search");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/menuActions.test.ts`
Expected: FAIL (`zoom-in` not returned; type also lacks the action).

- [ ] **Step 3: Extend the `MenuAction` type**

In `src/lib/menuActions.ts`, extend the union:

```ts
export type MenuAction =
  | "new-chat"
  | "search"
  | "toggle-sidebar"
  | "settings"
  | "usage"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "quit";
```

- [ ] **Step 4: Match the zoom keys in `menuActionForKey`**

Replace the body of `menuActionForKey` with (note: zoom is matched **before** the `shiftKey` early-return so `Ctrl/Cmd +` = `Shift+=` is caught):

```ts
export function menuActionForKey(e: KeyboardEvent): MenuAction | null {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey || e.isComposing) return null;

  // Zoom — allow Shift (US "+" is Shift+=). Match by key and by numpad code.
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") return "zoom-in";
  if (e.key === "-" || e.code === "NumpadSubtract") return "zoom-out";
  if (e.key === "0" || e.code === "Numpad0") return "zoom-reset";

  if (e.shiftKey) return null;
  switch (e.key.toLowerCase()) {
    case "n":
      return "new-chat";
    case "k":
      return "search";
    case "b":
      return "toggle-sidebar";
    case ",":
      return "settings";
    case "u":
      return "usage";
    case "q":
      return "quit";
    default:
      return null;
  }
}
```

- [ ] **Step 5: Handle the zoom actions in `runMenuAction`**

In `src/lib/menuActions.ts`, add an import at the top:

```ts
import { useZoom } from "@/store/zoom";
```

Add these cases to the `switch (action)` in `runMenuAction` (before `case "quit"`):

```ts
    case "zoom-in":
      useZoom.getState().zoomIn();
      break;
    case "zoom-out":
      useZoom.getState().zoomOut();
      break;
    case "zoom-reset":
      useZoom.getState().resetZoom();
      break;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/menuActions.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/menuActions.ts src/lib/menuActions.test.ts
git commit -m "feat(zoom): wire Ctrl/Cmd +/-/0 shortcuts to zoom actions"
```

---

## Task 6: Native menu zoom items

**Files:**
- Modify: `src-tauri/src/menu.rs`

- [ ] **Step 1: Create the three menu items**

In `src-tauri/src/menu.rs`, inside `install()`, after the `usage` item is created, add:

```rust
    let zoom_in = MenuItem::with_id(app, "menu_zoom_in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?;
    let zoom_out = MenuItem::with_id(app, "menu_zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let zoom_reset =
        MenuItem::with_id(app, "menu_zoom_reset", "Reset Zoom", true, Some("CmdOrCtrl+0"))?;
```

- [ ] **Step 2: Add them to the View submenu**

Change the `view` submenu construction to include the zoom items after a separator:

```rust
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &search,
            &toggle_sidebar,
            &PredefinedMenuItem::separator(app)?,
            &usage,
            &PredefinedMenuItem::separator(app)?,
            &zoom_in,
            &zoom_out,
            &zoom_reset,
        ],
    )?;
```

- [ ] **Step 3: Map the new ids in `on_menu_event`**

In the `match id` block of `on_menu_event`, add three arms:

```rust
        "menu_zoom_in" => "zoom-in",
        "menu_zoom_out" => "zoom-out",
        "menu_zoom_reset" => "zoom-reset",
```

- [ ] **Step 4: Build + lint the backend**

Run (from `src-tauri/`): `cargo build && cargo clippy`
Expected: PASS (no errors/warnings introduced).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/menu.rs
git commit -m "feat(zoom): add Zoom In/Out/Reset to the native View menu"
```

---

## Task 7: In-app menu bar zoom items

**Files:**
- Modify: `src/components/MenuBar.tsx`

- [ ] **Step 1: Add the zoom items to the View menu**

In `src/components/MenuBar.tsx`, inside the `View` `<Menu>`, after the `usage` item, add a separator and the three zoom items:

```tsx
        <Item action="usage" shortcut="U">
          {t("menu.usage")}
        </Item>
        <DropdownMenuSeparator />
        <Item action="zoom-in" shortcut="+">
          {t("menu.zoomIn")}
        </Item>
        <Item action="zoom-out" shortcut="-">
          {t("menu.zoomOut")}
        </Item>
        <Item action="zoom-reset" shortcut="0">
          {t("menu.resetZoom")}
        </Item>
```

(`Item`'s `action` prop is typed `MenuAction`, which now includes the zoom actions; `shortcut` is a free string passed to `shortcutLabel`.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/MenuBar.tsx
git commit -m "feat(zoom): add zoom items to the in-app View menu"
```

---

## Task 8: Theme card in Appearance settings

**Files:**
- Modify: `src/components/settings/Appearance.tsx`

> This adds the theme control to its new home. The old TitleBar theme radio is removed later (Task 14), so both coexist briefly — that's fine.

- [ ] **Step 1: Add the `ThemeCard` component**

In `src/components/settings/Appearance.tsx`, `useTheme` is already imported. Add a `ThemeCard` function (place it near `TitleBarCard`):

```tsx
/** Light / dark / system theme (moved here from the title-bar menu). */
function ThemeCard() {
  const t = useT();
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("appearance.theme.title")}</CardTitle>
        <CardDescription>{t("appearance.theme.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <OptionRow label={t("appearance.theme.title")}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={theme}
            onValueChange={(v) => v && setTheme(v as Theme)}
          >
            <ToggleGroupItem value="system">
              {t("appearance.theme.system")}
            </ToggleGroupItem>
            <ToggleGroupItem value="light">
              {t("appearance.theme.light")}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              {t("appearance.theme.dark")}
            </ToggleGroupItem>
          </ToggleGroup>
        </OptionRow>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Import the `Theme` type**

At the top of the file, add to the existing `@/lib/theme` import (which currently imports `resolveTheme`):

```ts
import { resolveTheme, type Theme } from "@/lib/theme";
```

- [ ] **Step 3: Render `ThemeCard` first in the Appearance list**

In the `Appearance()` component, add `<ThemeCard />` as the first card:

```tsx
  return (
    <div className="flex flex-col gap-4">
      <ThemeCard />
      <TitleBarCard />
      <ColorsCard />
      …
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/Appearance.tsx
git commit -m "feat(settings): add Theme card to Appearance (light/dark/system)"
```

---

## Task 9: Layout tier helpers (pure functions, TDD)

**Files:**
- Modify: `src/lib/layout.ts`
- Test: `src/lib/layout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/layout.test.ts`:

```ts
import {
  tierForWidth,
  initialCompactNav,
  RAIL_BREAKPOINT,
  PHONE_BREAKPOINT,
} from "@/lib/layout";

describe("tierForWidth", () => {
  it("is 'wide' at/above the rail breakpoint", () => {
    expect(tierForWidth(RAIL_BREAKPOINT)).toBe("wide");
    expect(tierForWidth(RAIL_BREAKPOINT + 200)).toBe("wide");
  });

  it("is 'tablet' between phone and rail breakpoints", () => {
    expect(tierForWidth(PHONE_BREAKPOINT)).toBe("tablet");
    expect(tierForWidth(RAIL_BREAKPOINT - 1)).toBe("tablet");
  });

  it("is 'phone' below the phone breakpoint", () => {
    expect(tierForWidth(PHONE_BREAKPOINT - 1)).toBe("phone");
    expect(tierForWidth(0)).toBe("phone");
  });
});

describe("initialCompactNav", () => {
  it("opens the pane on tablet, hides everything on phone, 0 on wide", () => {
    expect(initialCompactNav("tablet")).toBe(1);
    expect(initialCompactNav("phone")).toBe(0);
    expect(initialCompactNav("wide")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layout.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement the helpers**

In `src/lib/layout.ts`, add (after the existing `SIDEBAR_*` constants):

```ts
export type LayoutTier = "wide" | "tablet" | "phone";

/** Width (px) at/above which the icon rail + list pane show inline. */
export const RAIL_BREAKPOINT = 600;
/** Width (px) below which only the chat shows by default (phone). */
export const PHONE_BREAKPOINT = 480;

export function tierForWidth(px: number): LayoutTier {
  if (px >= RAIL_BREAKPOINT) return "wide";
  if (px >= PHONE_BREAKPOINT) return "tablet";
  return "phone";
}

/** Default compact disclosure level when entering a compact tier:
 *  tablet shows the pane (1), phone shows chat only (0). */
export function initialCompactNav(tier: LayoutTier): 0 | 1 {
  return tier === "tablet" ? 1 : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout.ts src/lib/layout.test.ts
git commit -m "feat(layout): add responsive tier + compact-nav helpers"
```

---

## Task 10: Layout store — tier + compactNav state machine

**Files:**
- Modify: `src/store/layout.ts`

> This adds the new state alongside the existing `mobileOpen` (which is removed in Task 14 when its consumers are migrated). Keeping both temporarily keeps everything compiling.

- [ ] **Step 1: Extend the store**

In `src/store/layout.ts`, update the imports to add the new helpers:

```ts
import {
  clampSidebarWidth,
  getStoredSidebarMode,
  getStoredSidebarOpen,
  getStoredSidebarWidth,
  storeSidebarMode,
  storeSidebarOpen,
  storeSidebarWidth,
  tierForWidth,
  initialCompactNav,
  type SidebarMode,
  type LayoutTier,
} from "@/lib/layout";
```

Add to the `LayoutState` interface:

```ts
  /** Current responsive tier (wide / tablet / phone). */
  tier: LayoutTier;
  /** Narrow-width disclosure: 0 = chat only, 1 = pane, 2 = pane + rail.
   *  Ephemeral (not persisted); reset when entering a compact tier. */
  compactNav: 0 | 1 | 2;

  setTier: (tier: LayoutTier) => void;
  cycleCompactNav: () => void;
  setCompactNav: (n: 0 | 1 | 2) => void;
```

Seed the new state in the `create(...)` initializer (compute the tier once from the current width):

```ts
export const useLayout = create<LayoutState>((set, get) => {
  const initialTier = tierForWidth(
    typeof window === "undefined" ? RAIL_BREAKPOINT : window.innerWidth,
  );
  return {
    sidebarOpen: getStoredSidebarOpen(),
    mobileOpen: false,
    sidebarWidth: getStoredSidebarWidth(),
    sidebarMode: getStoredSidebarMode(),
    tier: initialTier,
    compactNav: initialCompactNav(initialTier),

    // …existing actions (setSidebarOpen, setMobileOpen, setSidebarWidth,
    //   setSidebarMode) stay unchanged…
```

(Remember to add `RAIL_BREAKPOINT` to the import list above, and to close the function with `};` — the `create` callback now returns an object rather than being an object literal.)

Add the new actions inside the returned object:

```ts
    setTier: (tier) => {
      const prev = get().tier;
      // Entering a compact tier from wide: seed the disclosure default.
      if (prev === "wide" && tier !== "wide") {
        set({ tier, compactNav: initialCompactNav(tier) });
      } else {
        set({ tier });
      }
    },

    cycleCompactNav: () =>
      set({ compactNav: ((get().compactNav + 1) % 3) as 0 | 1 | 2 }),

    setCompactNav: (n) => set({ compactNav: n }),
```

- [ ] **Step 2: Make `toggleSidebar` tier-aware**

Replace the existing `toggleSidebar` action with:

```ts
    toggleSidebar: () => {
      if (get().tier === "wide") {
        const open = !get().sidebarOpen;
        storeSidebarOpen(open);
        set({ sidebarOpen: open });
      } else {
        // Compact: the 3-step cycle (chat → pane → pane+rail → chat).
        set({ compactNav: ((get().compactNav + 1) % 3) as 0 | 1 | 2 });
      }
    },
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS (existing consumers of `mobileOpen` still compile).

- [ ] **Step 4: Commit**

```bash
git add src/store/layout.ts
git commit -m "feat(layout): add tier + compactNav state machine to the store"
```

---

## Task 11: SidebarRail component (icon-only sections + tooltips)

**Files:**
- Create: `src/components/sidebar/SidebarRail.tsx`

> New file, not yet imported anywhere — compiles in isolation. The cog menu is a placeholder here and filled in Task 12.

- [ ] **Step 1: Write the rail**

Create `src/components/sidebar/SidebarRail.tsx`:

```tsx
import { Bot, Folder, MessagesSquare, type LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ManageMenu } from "./ManageMenu";
import { useLayout } from "@/store/layout";
import { useT, type MessageKey } from "@/store/i18n";
import type { SidebarMode } from "@/lib/layout";
import { cn } from "@/lib/utils";

interface SidebarSection {
  id: SidebarMode;
  labelKey: MessageKey;
  Icon: LucideIcon;
}

// Single source of truth for rail entries. Adding a section is a one-line edit
// here; a future plugin "view" category would extend this list (see spec).
const SECTIONS: SidebarSection[] = [
  { id: "chats", labelKey: "sidebar.chats", Icon: MessagesSquare },
  { id: "projects", labelKey: "sidebar.projects", Icon: Folder },
  { id: "bots", labelKey: "sidebar.bots", Icon: Bot },
];

/** Vertical, fully left-aligned icon rail (VS Code / Teams activity bar). Top
 *  group switches the list-pane section; the bottom holds the Manage (cog)
 *  menu. `variant="overlay"` is used inside the compact Sheet. */
export function SidebarRail({
  variant = "inline",
}: {
  variant?: "inline" | "overlay";
}) {
  const t = useT();
  const mode = useLayout((s) => s.sidebarMode);
  const setMode = useLayout((s) => s.setSidebarMode);
  const tier = useLayout((s) => s.tier);
  const setSidebarOpen = useLayout((s) => s.setSidebarOpen);
  const compactNav = useLayout((s) => s.compactNav);
  const setCompactNav = useLayout((s) => s.setCompactNav);

  const onSelect = (id: SidebarMode) => {
    setMode(id);
    // Ensure the list pane is visible (mode switch alone doesn't open it).
    if (tier === "wide") setSidebarOpen(true);
    else if (compactNav < 1) setCompactNav(1);
  };

  return (
    <nav
      aria-label={t("sidebar.navigation")}
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border flex w-12 shrink-0 flex-col items-center border-r py-2",
        variant === "overlay" && "z-20 shadow-lg",
      )}
    >
      <div className="flex flex-col items-center gap-1">
        {SECTIONS.map(({ id, labelKey, Icon }) => {
          const active = mode === id;
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelect(id)}
                  aria-label={t(labelKey)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex size-9 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  )}
                >
                  {active && (
                    <span className="bg-primary absolute top-1.5 bottom-1.5 -left-2 w-0.5 rounded-full" />
                  )}
                  <Icon className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t(labelKey)}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex-1" />

      <ManageMenu />
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck (will fail until Task 12)**

Run: `npm run build`
Expected: FAIL (cannot resolve `./ManageMenu`). Proceed to Task 12; they compile together.

(No commit yet — commit at the end of Task 12.)

---

## Task 12: ManageMenu (the cog menu at the rail bottom)

**Files:**
- Create: `src/components/sidebar/ManageMenu.tsx`

- [ ] **Step 1: Write the cog menu**

Create `src/components/sidebar/ManageMenu.tsx`:

```tsx
import { Cog, Minus, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { runMenuAction, shortcutLabel } from "@/lib/menuActions";
import { useZoom } from "@/store/zoom";
import { useConnectivity } from "@/store/connectivity";
import { useT } from "@/store/i18n";

/** The "Manage" menu — relocated from the old TitleBar "⋯" dropdown. Settings,
 *  Usage, a browser-style zoom row, and the Work-offline toggle. Theme moved to
 *  Settings › Appearance. */
export function ManageMenu() {
  const t = useT();
  const zoom = useZoom((s) => s.zoom);
  const zoomIn = useZoom((s) => s.zoomIn);
  const zoomOut = useZoom((s) => s.zoomOut);
  const resetZoom = useZoom((s) => s.resetZoom);
  const forceOffline = useConnectivity((s) => s.forceOffline);
  const setForceOffline = useConnectivity((s) => s.setForceOffline);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t("rail.manage")}
              className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground flex size-9 items-center justify-center rounded-lg transition-colors"
            >
              <Cog className="size-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t("rail.manage")}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuItem onClick={() => runMenuAction("settings")}>
          {t("titleBar.settings")}
          <DropdownMenuShortcut>{shortcutLabel(",")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => runMenuAction("usage")}>
          {t("titleBar.usage")}
          <DropdownMenuShortcut>{shortcutLabel("U")}</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Zoom row — plain buttons (not menu items) so the menu stays open
            across repeated clicks. */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm">{t("manage.zoom")}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              aria-label={t("menu.zoomOut")}
              className="hover:bg-accent flex size-6 items-center justify-center rounded"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="w-10 text-center text-xs tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={zoomIn}
              aria-label={t("menu.zoomIn")}
              className="hover:bg-accent flex size-6 items-center justify-center rounded"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
        <DropdownMenuItem onClick={resetZoom}>
          {t("menu.resetZoom")}
          <DropdownMenuShortcut>{shortcutLabel("0")}</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={forceOffline === true}
          onCheckedChange={(v) => void setForceOffline(v === true)}
        >
          {t("titleBar.workOffline")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS (SidebarRail + ManageMenu now resolve).

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/SidebarRail.tsx src/components/sidebar/ManageMenu.tsx
git commit -m "feat(sidebar): add icon rail + Manage (cog) menu components"
```

---

## Task 13: SidebarPane component (pane header + contextual New)

**Files:**
- Create: `src/components/sidebar/SidebarPane.tsx`

> New file, not yet imported. Moves the New actions into a pane header; the list panes are unchanged.

- [ ] **Step 1: Write the pane**

Create `src/components/sidebar/SidebarPane.tsx`:

```tsx
import type { ReactNode } from "react";
import { Bot, FolderPlus, Ghost, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatsPane } from "./ChatsPane";
import { ProjectsPane } from "./ProjectsPane";
import { BotsPane } from "./BotsPane";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { useBots } from "@/store/bots";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";
import { useT } from "@/store/i18n";

/** The list pane: a contextual header (section title + New action) over the
 *  active Chats / Projects / Personas list. Rendered inside the inline aside
 *  (wide) and inside the compact overlay Sheet. */
export function SidebarPane() {
  const t = useT();
  const mode = useLayout((s) => s.sidebarMode);
  const startNewChat = useThreads((s) => s.startNewChat);
  const createProject = useProjects((s) => s.create);
  const openProject = useProjects((s) => s.open);
  const closeProject = useProjects((s) => s.close);
  const createBot = useBots((s) => s.create);
  const openBot = useBots((s) => s.open);
  const closeBot = useBots((s) => s.close);
  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);

  const onNewChat = (opts?: { incognito?: boolean }) => {
    showChat();
    clearSearch();
    closeProject();
    closeBot();
    startNewChat(opts);
  };

  const onNewProject = async () => {
    showChat();
    clearSearch();
    closeBot();
    const p = await createProject();
    await openProject(p.id);
  };

  const onNewBot = async () => {
    showChat();
    clearSearch();
    closeProject();
    const b = await createBot();
    openBot(b.id);
  };

  const title =
    mode === "chats"
      ? t("sidebar.chats")
      : mode === "projects"
        ? t("sidebar.projects")
        : t("sidebar.bots");

  return (
    <>
      <div className="flex items-center justify-between gap-1 px-3 pt-3 pb-1">
        <span className="text-sidebar-foreground/60 text-xs font-semibold tracking-wide uppercase">
          {title}
        </span>
        <div className="flex items-center gap-0.5">
          {mode === "chats" ? (
            <>
              <PaneAction label={t("sidebar.newChat")} onClick={() => onNewChat()}>
                <Plus className="size-4" />
              </PaneAction>
              <PaneAction
                label={t("sidebar.newIncognitoChat")}
                onClick={() => onNewChat({ incognito: true })}
              >
                <Ghost className="size-4" />
              </PaneAction>
            </>
          ) : mode === "projects" ? (
            <PaneAction
              label={t("sidebar.newProject")}
              onClick={() => void onNewProject()}
            >
              <FolderPlus className="size-4" />
            </PaneAction>
          ) : (
            <PaneAction label={t("sidebar.newBot")} onClick={() => void onNewBot()}>
              <Bot className="size-4" />
            </PaneAction>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {mode === "chats" ? (
          <ChatsPane />
        ) : mode === "projects" ? (
          <ProjectsPane />
        ) : (
          <BotsPane />
        )}
      </div>
    </>
  );
}

function PaneAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-7 items-center justify-center rounded-md transition-colors"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/SidebarPane.tsx
git commit -m "feat(sidebar): add list pane with contextual New header"
```

---

## Task 14: Wire it together — App, Sidebar, TitleBar; remove old pieces

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/TitleBar.tsx`
- Modify: `src/store/layout.ts` (remove `mobileOpen`)
- Delete: `src/components/sidebar/SidebarModeSwitch.tsx`, `src/components/sidebar/SidebarHeader.tsx`
- Modify: `src/lib/i18n.ts` + `src/locales/{de,fr,pl,es,da}.json` (remove `titleBar.theme*`)

> This is the atomic cut-over: every consumer migrates in one task so the app compiles and runs at the end.

- [ ] **Step 1: Rewrite `Sidebar.tsx`**

Replace the entire contents of `src/components/sidebar/Sidebar.tsx` with:

```tsx
import { SidebarPane } from "./SidebarPane";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { useLayout } from "@/store/layout";

/** The inline list pane (wide tier): a resizable, persisted-width column. The
 *  icon rail is a separate sibling rendered by App and stays visible even when
 *  this pane is collapsed. Visibility is controlled by App (tier + sidebarOpen). */
export function Sidebar() {
  const width = useLayout((s) => s.sidebarWidth);

  return (
    <aside
      className="bg-sidebar text-sidebar-foreground border-sidebar-border animate-in slide-in-from-left-4 fade-in-0 relative flex shrink-0 flex-col border-r duration-200"
      style={{ width }}
    >
      <SidebarPane />
      <SidebarResizeHandle />
    </aside>
  );
}
```

(The `SidebarContent` export is removed; the mode switch / header / new-button block is gone — replaced by the rail + pane header.)

- [ ] **Step 2: Delete the obsolete components**

```bash
git rm src/components/sidebar/SidebarModeSwitch.tsx src/components/sidebar/SidebarHeader.tsx
```

- [ ] **Step 3: Update `src/App.tsx` — imports**

Replace the sidebar import line:

```ts
import { Sidebar, SidebarContent } from "@/components/sidebar/Sidebar";
```

with:

```ts
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SidebarRail } from "@/components/sidebar/SidebarRail";
import { SidebarPane } from "@/components/sidebar/SidebarPane";
```

Update the layout-store selectors near the top of `App()`:

```ts
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const tier = useLayout((s) => s.tier);
  const setTier = useLayout((s) => s.setTier);
  const compactNav = useLayout((s) => s.compactNav);
  const setCompactNav = useLayout((s) => s.setCompactNav);
```

(Remove the old `mobileOpen` / `setMobileOpen` selectors.)

- [ ] **Step 4: Register the tier listener in `App.tsx`**

Add a new effect (near the other effects) that tracks the viewport tier:

```ts
  // Track the responsive tier (wide ≥600 / tablet / phone) for the rail + the
  // 3-step compact toggle. matchMedia keeps it in sync without a resize storm.
  useEffect(() => {
    const apply = () => setTier(tierForWidth(window.innerWidth));
    apply();
    const mq = window.matchMedia(`(min-width: ${RAIL_BREAKPOINT}px)`);
    const mqPhone = window.matchMedia(`(min-width: ${PHONE_BREAKPOINT}px)`);
    mq.addEventListener("change", apply);
    mqPhone.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      mqPhone.removeEventListener("change", apply);
    };
  }, [setTier]);
```

Add the import:

```ts
import { tierForWidth, RAIL_BREAKPOINT, PHONE_BREAKPOINT } from "@/lib/layout";
```

- [ ] **Step 5: Update the layout JSX in `App.tsx`**

Replace the inline-sidebar + mobile-Sheet block. Find:

```tsx
        <div className="flex min-h-0 flex-1">
          {/* Inline sidebar (>= md), shown unless collapsed. */}
          {sidebarOpen && <Sidebar />}

          {/* Overlay sidebar for narrow widths. … */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="bg-sidebar text-sidebar-foreground gap-0 p-0"
              style={{
                top: menuBarMode === "inline" ? 60 : 32,
                height: `calc(100% - ${menuBarMode === "inline" ? 60 : 32}px)`,
              }}
            >
              <SheetTitle className="sr-only">
                {t("sidebar.navigation")}
              </SheetTitle>
              <SidebarContent />
            </SheetContent>
          </Sheet>
```

Replace with:

```tsx
        <div className="flex min-h-0 flex-1">
          {/* Icon rail (wide tier): always visible, independent of the pane. */}
          {tier === "wide" && <SidebarRail />}

          {/* Inline list pane (wide tier): shown unless collapsed. */}
          {tier === "wide" && sidebarOpen && <Sidebar />}

          {/* Compact tiers (<600px): rail + pane as a left overlay. compactNav
              0 = chat only, 1 = pane, 2 = pane + rail (rail to the left). */}
          <Sheet
            open={compactNav >= 1}
            onOpenChange={(o) => setCompactNav(o ? 1 : 0)}
          >
            <SheetContent
              side="left"
              showCloseButton={false}
              className="bg-sidebar text-sidebar-foreground flex flex-row gap-0 p-0"
              style={{
                top: menuBarMode === "inline" ? 60 : 32,
                height: `calc(100% - ${menuBarMode === "inline" ? 60 : 32}px)`,
                width: compactNav >= 2 ? 320 : 272,
              }}
            >
              <SheetTitle className="sr-only">
                {t("sidebar.navigation")}
              </SheetTitle>
              {compactNav >= 2 && <SidebarRail variant="overlay" />}
              <div className="flex min-w-0 flex-1 flex-col">
                <SidebarPane />
              </div>
            </SheetContent>
          </Sheet>
```

- [ ] **Step 6: Rewrite the `TitleBar()` chrome — move Search left, drop the "⋯" menu**

In `src/components/TitleBar.tsx`:

(a) Replace the import block at the top with (drops `MoreVertical`, `Settings2`, `BarChart3`, `Menu`, the `DropdownMenu*` set, `useTheme`, and the `Theme` type; keeps the rest):

```tsx
import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Minus,
  PanelLeft,
  PanelLeftClose,
  Search,
  Square,
  WifiOff,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayout } from "@/store/layout";
import { useConnectivity, useIsOffline } from "@/store/connectivity";
import { useT } from "@/store/i18n";
import { runMenuAction, shortcutLabel } from "@/lib/menuActions";
import type { ControlsStyle } from "@/lib/titlebar";
```

(b) Replace the selector block inside `TitleBar()` (drop `setView`, `theme`, `setTheme`, `setForceOffline`; keep the rest; add `tier`):

```tsx
  const t = useT();
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const tier = useLayout((s) => s.tier);
  const toggleSidebar = useLayout((s) => s.toggleSidebar);
  const barMode = useTitleBar((s) => s.mode);
  const controlsSide = useTitleBar((s) => s.side);
  const controlsStyle = useTitleBar((s) => s.style);
  const offline = useIsOffline();
  const forceOffline = useConnectivity((s) => s.forceOffline);
  const refreshConnectivity = useConnectivity((s) => s.refresh);

  const showControls = barMode === "custom";
```

(`useTitleBar` is still imported — leave that import line as-is.)

(c) Replace the **sidebar-toggle block** (the `<div className="flex items-center">` containing the mobile hamburger + desktop toggle) with a single tier-aware toggle, immediately followed by the Search button:

```tsx
      {/* Sidebar toggle — collapses the pane (wide) or cycles the 3-step
          compact disclosure (<600px). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleSidebar}
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-8 items-center justify-center transition-colors"
            aria-label={
              sidebarOpen ? t("titleBar.hideSidebar") : t("titleBar.showSidebar")
            }
          >
            {tier === "wide" && sidebarOpen ? (
              <PanelLeftClose className="size-3.5" />
            ) : (
              <PanelLeft className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {sidebarOpen ? t("titleBar.hideSidebar") : t("titleBar.showSidebar")}
        </TooltipContent>
      </Tooltip>

      {/* Search — moved to the left cluster. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => runMenuAction("search")}
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-8 items-center justify-center transition-colors"
            aria-label={t("titleBar.searchChats")}
          >
            <Search className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("titleBar.searchChats")} ({shortcutLabel("K")})
        </TooltipContent>
      </Tooltip>
```

(d) **Remove** the old right-side Search button block (the `{/* Search (opens the top-center search overlay) */}` Tooltip) and the **entire** `{/* Menu dropdown */}` `<DropdownMenu>…</DropdownMenu>` block. Keep the offline badge block and the trailing `WindowControls` block. The right side of the bar now holds only the offline badge (when offline) + window controls.

- [ ] **Step 7: Remove `mobileOpen` from the layout store**

In `src/store/layout.ts`, delete the `mobileOpen: boolean;` and `setMobileOpen` from the interface, the `mobileOpen: false,` seed, and the `setMobileOpen: (open) => set({ mobileOpen: open }),` action. (Search the repo for `mobileOpen` to confirm no other consumers remain — after Steps 5–6 there should be none.)

- [ ] **Step 8: Remove the obsolete `titleBar.theme*` i18n keys**

In `src/lib/i18n.ts`, delete these four entries from the `en` object:

```ts
  "titleBar.theme": …,
  "titleBar.themeSystem": …,
  "titleBar.themeLight": …,
  "titleBar.themeDark": …,
```

Delete the same four keys from each of `src/locales/{de,fr,pl,es,da}.json` `strings` objects (the locales "no unknown keys" test fails otherwise).

- [ ] **Step 9: Typecheck + lint + tests**

Run: `npm run build && npm run lint && npx vitest run`
Expected: PASS. If `tsc` reports an unused import or a leftover `mobileOpen`/`SidebarContent`/`setView` reference, remove it.

- [ ] **Step 10: Manual smoke test**

Run: `npm run tauri dev` and verify:
- The icon rail shows on the left with Chats/Projects/Personas; tooltips on hover; active section highlighted.
- Clicking a rail icon switches the list; the pane header shows the section title + New action(s).
- The cog (bottom-left) opens the Manage menu: Settings, Usage, Zoom row (−/%/+), Reset Zoom, Work offline.
- Search is in the TitleBar's left cluster; the "⋯" menu is gone.
- Resize the window narrow (<600px): rail hides; the toggle cycles chat → sidebar → sidebar+rail (overlay); the rail layers next to the sidebar.
- Theme now lives in Settings › Appearance and still switches light/dark/system.
- `Ctrl/Cmd +`, `-`, `0` zoom the window; the cog Zoom readout updates.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(nav): cut over to icon rail + responsive compact overlay; relocate search/manage/theme"
```

---

## Task 15: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Frontend build + lint + format + tests**

Run: `npm run build && npm run lint && npm run format:check && npx vitest run`
Expected: all PASS. (If `format:check` flags files, run `npm run format` and commit the formatting.)

- [ ] **Step 2: Backend build + lint**

Run (from `src-tauri/`): `cargo build && cargo clippy && cargo fmt --check`
Expected: all PASS. (If `cargo fmt --check` flags files, run `cargo fmt` and commit.)

- [ ] **Step 3: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: formatting after icon-rail navigation"
```

(Skip if nothing changed.)

---

## Self-review checklist (done while writing — recorded here)

- **Spec coverage** — each spec requirement maps to a task:
  - Icon rail + data-driven `SidebarSection[]` → T11
  - Responsive tiers + 3-step compact toggle → T9, T10, T14
  - Rail overlays sidebar in compact → T14 (Step 5)
  - Search → TitleBar left cluster → T14 (Step 6)
  - "⋯" menu → cog "Manage" menu → T12, T14
  - Theme → Settings › Appearance (and removed from TitleBar) → T8, T14
  - Zoom lib / store / permission / apply-on-mount → T2, T3, T4
  - Zoom shortcuts (Ctrl/Cmd +/-/0) → T5
  - Native + in-app menu zoom items → T6, T7
  - Cog zoom row → T12
  - i18n keys added → T1; obsolete `titleBar.theme*` removed → T14
  - Tests (zoom lib, menu keys, layout helpers) → T2, T5, T9
- **Placeholder scan:** no TBD/TODO; every code step shows full code.
- **Type consistency:** `compactNav: 0|1|2`, `tier: LayoutTier`, `MenuAction` zoom members, `SidebarSection`, and the `useZoom`/`useLayout` action names are used consistently across tasks.

## Out of scope (from spec)

Plugin "view" category contributing rail entries; persisting `compactNav`; user reordering/hiding rail icons; per-section pane-width memory; pinch/Ctrl-scroll zoom; per-window/thread zoom memory.
