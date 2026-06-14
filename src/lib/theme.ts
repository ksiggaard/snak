// Theme handling. The preference is one of light/dark/system; "system" follows
// the OS color scheme via `prefers-color-scheme`. Stored in localStorage (a
// pure UI concern, kept out of the SQLite settings table) so it can be read
// synchronously at startup with no flash of the wrong theme.

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

/**
 * Resolve a theme CSS custom property (e.g. `--card`) to a concrete, portable
 * color string. Reads the variable through a throwaway probe element so the
 * browser normalises whatever the active theme defines — `oklch(...)`, a hex,
 * or a user/installed-theme override — to a plain `rgb(...)`. Used to bake a
 * background into enlarged/downloaded SVGs (T54), where `oklch()` may not be
 * understood by external viewers. Returns `""` if it can't be resolved.
 */
export function resolveCssVarColor(varName: string): string {
  try {
    const probe = document.createElement("span");
    probe.style.color = `var(${varName})`;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color || "";
  } catch {
    return "";
  }
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
