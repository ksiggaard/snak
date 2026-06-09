import { create } from "zustand";
import {
  applyInstalledThemeCss,
  applyTheme,
  getStoredTheme,
  getStoredThemeId,
  storeTheme,
  storeThemeId,
  type Theme,
} from "@/lib/theme";
import { listThemes, type InstalledTheme } from "@/lib/themes";

interface ThemeState {
  /** Light/dark/system preference (the base palette + `.dark` toggle). */
  theme: Theme;
  /** Installed themes discovered from the app-data themes folder (T11). */
  installed: InstalledTheme[];
  /** Selected installed-theme id, or null for the built-in default palette. */
  themeId: string | null;
  /** Whether `loadInstalled` has run at least once. */
  loaded: boolean;
  error: string | null;

  setTheme: (theme: Theme) => void;
  /**
   * Discover installed themes from the backend (the themes folder) and re-apply
   * the saved one. `extra` lets a caller fold in additional themes from another
   * source — used to compose the T12 plugin registry's `theme` contributions
   * (see `Themes.tsx`) so both folder themes and plugin themes share one
   * selector. Entries are merged by id; folder themes win on collision.
   */
  loadInstalled: (extra?: InstalledTheme[]) => Promise<void>;
  /** Select an installed theme by id (null = built-in default), and persist. */
  selectTheme: (id: string | null) => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Find a theme's CSS by id within a list, or null if absent. */
function cssFor(installed: InstalledTheme[], id: string | null): string | null {
  if (id === null) return null;
  return installed.find((t) => t.id === id)?.css ?? null;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: getStoredTheme(),
  installed: [],
  themeId: getStoredThemeId(),
  loaded: false,
  error: null,

  setTheme: (theme) => {
    storeTheme(theme);
    applyTheme(theme);
    set({ theme });
  },

  loadInstalled: async (extra = []) => {
    try {
      const folder = await listThemes();
      // Merge folder themes with any caller-supplied (e.g. plugin-registry)
      // themes; folder themes win on id collision.
      const seen = new Set(folder.map((t) => t.id));
      const installed = [...folder, ...extra.filter((t) => !seen.has(t.id))];
      // The saved selection may reference a theme that was since removed; fall
      // back to the default palette in that case.
      const id = get().themeId;
      const css = cssFor(installed, id);
      applyInstalledThemeCss(css);
      if (id !== null && css === null) {
        storeThemeId(null);
        set({ installed, themeId: null, loaded: true, error: null });
      } else {
        set({ installed, loaded: true, error: null });
      }
    } catch (e) {
      set({ error: errMsg(e), loaded: true });
    }
  },

  selectTheme: (id) => {
    storeThemeId(id);
    applyInstalledThemeCss(cssFor(get().installed, id));
    set({ themeId: id });
  },
}));

// Apply the stored light/dark theme as soon as this module loads (before first
// paint), and re-apply on OS color-scheme changes while following "system".
applyTheme(getStoredTheme());
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (useTheme.getState().theme === "system") applyTheme("system");
  });
