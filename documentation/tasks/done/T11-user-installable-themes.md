# T11 — User-installable themes

- **Status:** done
- **Owner:** Wave2-T11
- **Priority:** P2
- **Layer:** Frontend + Rust (filesystem load)
- **Depends on:** —

(README idea 4.) A theme is a folder with a manifest file + a stylesheet; users drop themes
into a themes directory and select them. Builds on the existing CSS-variable theming in
`src/index.css` and `src/store/theme.ts`.

**Acceptance criteria:**
- Defined theme folder format: manifest (name/author/version) + a CSS file overriding the
  documented CSS variables.
- Rust loads installed themes from an app data directory and exposes them; the frontend
  lists/selects/applies one (persisted alongside the existing theme preference).
- Documentation of the available CSS variables and how to author a theme.

**Notes:**
- Could later be delivered as a "Theme" plugin category under T12.
- 2026-06-09 (Wave2-T11): Implemented a **parallel themes-folder loader** rather than going
  through the T12 plugin registry. Rationale: T11's required on-disk format is a *folder*
  with a separate `theme.json` + `theme.css`, whereas the plugin host's `theme` contribution
  inlines `{ name, css }` in `manifest.json` and the host only reads `manifest.json` — so the
  folder format is not loadable by the plugin host without modifying its internals (out of
  scope). The two are **composed** in the UI: the Themes card folds enabled `theme`-category
  plugin contributions (read via `selectRegistry`) into the same selector as folder themes.
  - **Format:** `…/themes/<id>/theme.json` (`name`, `version`, optional `author`) + `theme.css`
    (overrides the documented `--*` vars). Folder name = stable selection id.
  - **Rust:** `src-tauri/src/commands/themes.rs` — `list_themes` (discover + validate, skip
    bad folders) and `themes_directory` (reveal path, create on demand). `app_data_dir()` via
    `AppHandle::path()`; direct `std::fs` reads (no fs-plugin permission needed). Pure
    `parse_theme_manifest`/`validate_theme_manifest`, unit-tested (5 tests).
  - **Frontend:** `src/lib/themes.ts` wrappers; `src/store/theme.ts` extended (`installed`,
    `themeId`, `loadInstalled`, `selectTheme`); `src/lib/theme.ts` adds `getStoredThemeId`/
    `storeThemeId`/`applyInstalledThemeCss` (injects a `<style id="installed-theme">`).
    Selection persisted in localStorage (alongside light/dark), re-applied on startup from
    `App.tsx`. Settings card `src/components/settings/Themes.tsx`. Composes with light/dark
    (theme CSS only re-tints the documented vars). Tests: `src/store/theme.test.ts` +
    additions to `src/lib/theme.test.ts`.
  - **Docs:** `docs/theming.md` (format, variable list, light/dark, install) + a documented
    CSS-variable-contract comment block in `src/index.css`.
