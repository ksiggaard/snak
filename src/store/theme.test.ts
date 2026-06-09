import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledTheme } from "@/lib/themes";

// Mock the Tauri-backed loader and the DOM apply helpers so the store logic
// (merge, fallback, persistence) can be tested in isolation.
const listThemes = vi.fn<() => Promise<InstalledTheme[]>>();
vi.mock("@/lib/themes", () => ({
  listThemes: () => listThemes(),
  themesDirectory: vi.fn(),
}));

const applyInstalledThemeCss = vi.fn<(css: string | null) => void>();
let storedThemeId: string | null = null;
vi.mock("@/lib/theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/theme")>();
  return {
    ...actual,
    applyTheme: vi.fn(),
    getStoredThemeId: () => storedThemeId,
    storeThemeId: (id: string | null) => {
      storedThemeId = id;
    },
    applyInstalledThemeCss: (css: string | null) => applyInstalledThemeCss(css),
  };
});

// The store runs `window.matchMedia(...)` at module load; jsdom does not
// implement it, so provide a minimal stub before importing the store.
vi.stubGlobal(
  "matchMedia",
  vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
);

// Imported after the mocks are registered.
const { useTheme } = await import("@/store/theme");

const theme = (id: string, css: string): InstalledTheme => ({
  id,
  name: id,
  author: null,
  version: "1.0.0",
  css,
});

beforeEach(() => {
  listThemes.mockReset();
  applyInstalledThemeCss.mockClear();
  storedThemeId = null;
  useTheme.setState({ installed: [], themeId: null, loaded: false, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTheme installable themes (T11)", () => {
  it("loads folder themes and marks loaded", async () => {
    listThemes.mockResolvedValue([theme("nord", ":root{}")]);
    await useTheme.getState().loadInstalled();
    expect(useTheme.getState().installed.map((t) => t.id)).toEqual(["nord"]);
    expect(useTheme.getState().loaded).toBe(true);
  });

  it("merges folder + extra (plugin) themes, folder winning on collision", async () => {
    listThemes.mockResolvedValue([theme("nord", "FOLDER")]);
    await useTheme
      .getState()
      .loadInstalled([theme("nord", "PLUGIN"), theme("dracula", "PLUGIN")]);
    const installed = useTheme.getState().installed;
    expect(installed.map((t) => t.id)).toEqual(["nord", "dracula"]);
    expect(installed.find((t) => t.id === "nord")?.css).toBe("FOLDER");
  });

  it("re-applies the saved theme's CSS on load", async () => {
    storedThemeId = "nord";
    useTheme.setState({ themeId: "nord" });
    listThemes.mockResolvedValue([theme("nord", "NORD-CSS")]);
    await useTheme.getState().loadInstalled();
    expect(applyInstalledThemeCss).toHaveBeenLastCalledWith("NORD-CSS");
  });

  it("falls back to default when the saved theme is no longer installed", async () => {
    storedThemeId = "ghost";
    useTheme.setState({ themeId: "ghost" });
    listThemes.mockResolvedValue([theme("nord", "NORD-CSS")]);
    await useTheme.getState().loadInstalled();
    expect(useTheme.getState().themeId).toBeNull();
    expect(storedThemeId).toBeNull();
    expect(applyInstalledThemeCss).toHaveBeenLastCalledWith(null);
  });

  it("selectTheme applies CSS and persists the id", async () => {
    listThemes.mockResolvedValue([theme("nord", "NORD-CSS")]);
    await useTheme.getState().loadInstalled();
    useTheme.getState().selectTheme("nord");
    expect(useTheme.getState().themeId).toBe("nord");
    expect(storedThemeId).toBe("nord");
    expect(applyInstalledThemeCss).toHaveBeenLastCalledWith("NORD-CSS");
  });

  it("selectTheme(null) reverts to the default palette", async () => {
    listThemes.mockResolvedValue([theme("nord", "NORD-CSS")]);
    await useTheme.getState().loadInstalled();
    useTheme.getState().selectTheme(null);
    expect(useTheme.getState().themeId).toBeNull();
    expect(applyInstalledThemeCss).toHaveBeenLastCalledWith(null);
  });

  it("records an error when loading fails", async () => {
    listThemes.mockRejectedValue(new Error("boom"));
    await useTheme.getState().loadInstalled();
    expect(useTheme.getState().error).toBe("boom");
    expect(useTheme.getState().loaded).toBe(true);
  });
});
