// Theme handling. The preference is one of light/dark/system; "system" follows
// the OS color scheme via `prefers-color-scheme`. Stored in localStorage (a
// pure UI concern, kept out of the SQLite settings table) so it can be read
// synchronously at startup with no flash of the wrong theme.

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

/**
 * Selected installable-theme id (T11), persisted alongside the light/dark
 * preference in localStorage so it can be re-applied synchronously at startup
 * with no flash. `null`/absent means the built-in default palette.
 */
const THEME_ID_KEY = "theme-id";

/** The `<style>` element holding the active installed theme's CSS (T11). */
const THEME_STYLE_ID = "installed-theme";

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function getStoredThemeId(): string | null {
  return localStorage.getItem(THEME_ID_KEY);
}

export function storeThemeId(id: string | null): void {
  if (id === null) localStorage.removeItem(THEME_ID_KEY);
  else localStorage.setItem(THEME_ID_KEY, id);
}

/**
 * Inject (or replace) the active installed theme's CSS via a single `<style>`
 * element appended to `<head>`. Passing `null` removes it, reverting to the
 * built-in palette. The theme CSS only overrides the documented `--*`
 * variables, so it composes with the `.dark` class set by `applyTheme`.
 */
export function applyInstalledThemeCss(css: string | null): void {
  let el = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (css === null || css === "") {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = THEME_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

/** Toggle the `.dark` class on <html> (and <body>) to match the resolved theme.
 * Radix portals are direct children of <body>; mirroring the class there ensures
 * CSS custom properties cascade into them even when WebKitGTK doesn't propagate
 * variables across composited-layer stacking-context boundaries. */
export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme);
  const isDark = resolved === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.body?.classList.toggle("dark", isDark);
}
