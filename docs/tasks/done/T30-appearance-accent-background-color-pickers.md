# T30 — Appearance: accent + background color pickers

- **Status:** done
- **Owner:** Agent-T30-T33
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 3.) Let the user pick the theme's main (accent) color and background color
directly from the Appearance settings, without authoring a full T11 theme folder.

**Acceptance criteria:**
- Color pickers in Settings → Appearance (`src/components/settings/Appearance.tsx`) for
  at least **accent** (`--primary` family) and **background** (`--background` family),
  with a reset-to-default per color.
- Custom colors are applied as CSS-variable overrides (same mechanism as installed theme
  CSS — e.g. a dedicated `<style>` element like `applyInstalledThemeCss`) and persist in
  localStorage (synchronous at startup, no flash — mirrors `lib/theme.ts`).
- Composes sensibly with light/dark and with installed/plugin themes — decide and
  document precedence (suggested: custom picks override the active theme) and whether a
  pick applies to both light and dark or is per-mode.
- Derived tokens stay readable (e.g. `--primary-foreground` contrast when the accent
  changes) — compute or document limits.

**Notes:**
- Keep the picker dependency-light (a native `<input type="color">` styled to match may
  be enough; WebKitGTK support verified).
- 2026-06-12 (Agent-T30-T33): Implemented. New "Colors" card in `Appearance.tsx`
  (native `<input type="color">` + per-color Reset, no new deps); pure helpers +
  persistence in `src/lib/appearance.ts` (unit-tested, `appearance.test.ts`), state in
  `src/store/appearance.ts` (`useAppearance`).
- 2026-06-12: **Decisions** — (1) Picks are **per-mode**: a pick edits whichever of
  light/dark is currently active and is stored separately for each (one localStorage key
  `custom-colors`, `{ light: {…}, dark: {…} }`). (2) **Precedence:** custom picks
  override installed/plugin themes — overrides are emitted into
  `<style id="custom-colors">` with doubled-specificity scopes
  (`:root:not(.dark), body:not(.dark)` / `:root.dark, body.dark`), which beat a theme's
  `:root`/`.dark` rules regardless of style-element order (body mirrored for the
  WebKitGTK portal quirk). (3) **Contrast:** `--primary-foreground` (and `--foreground`
  for background picks) is computed from WCAG relative luminance → white or near-black
  (`contrastForeground`, unit-tested). Hex values are valid CSS var values since all
  consumers use `var()` (Tailwind v4 `--color-* : var(--*)` mapping).
- 2026-06-12: **Documented limits** — only `--primary`/`--background` (+ computed
  foregrounds) are overridden; derived surfaces (`--card`, `--muted`, `--sidebar`, …)
  keep theme values. Picker seed colors when unset are sRGB approximations of the
  built-in palette (a color input can't display oklch), so the seed may not match an
  installed theme until a pick is made. Startup apply is module-level in
  `store/appearance.ts` (side-effect import in `App.tsx`), before first paint — no
  flash. Verified: `npm run build`, `npm run lint`, `npm test` (243 passed) all green.
