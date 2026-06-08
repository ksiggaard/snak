import { create } from "zustand";
import {
  applyTheme,
  getStoredTheme,
  storeTheme,
  type Theme,
} from "@/lib/theme";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: getStoredTheme(),
  setTheme: (theme) => {
    storeTheme(theme);
    applyTheme(theme);
    set({ theme });
  },
}));

// Apply the stored theme as soon as this module loads (before first paint),
// and re-apply on OS color-scheme changes while following "system".
applyTheme(getStoredTheme());
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (useTheme.getState().theme === "system") applyTheme("system");
  });
