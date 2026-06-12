import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStoredTheme,
  storeTheme,
  systemPrefersDark,
  resolveTheme,
  applyTheme,
} from "@/lib/theme";

/** Install a matchMedia mock that reports the given dark-mode preference. */
function mockMatchMedia(prefersDark: boolean) {
  const fn = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("dark") ? prefersDark : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal("matchMedia", fn);
  // jsdom puts matchMedia on window; mirror it there too.
  window.matchMedia = fn as unknown as typeof window.matchMedia;
  return fn;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getStoredTheme", () => {
  it("defaults to 'system' when nothing is stored", () => {
    expect(getStoredTheme()).toBe("system");
  });

  it("defaults to 'system' for an invalid stored value", () => {
    localStorage.setItem("theme", "rainbow");
    expect(getStoredTheme()).toBe("system");
  });

  it.each(["light", "dark", "system"] as const)(
    "round-trips a stored '%s' preference via storeTheme",
    (theme) => {
      storeTheme(theme);
      expect(localStorage.getItem("theme")).toBe(theme);
      expect(getStoredTheme()).toBe(theme);
    },
  );
});

describe("systemPrefersDark", () => {
  it("reflects a dark OS preference", () => {
    mockMatchMedia(true);
    expect(systemPrefersDark()).toBe(true);
  });

  it("reflects a light OS preference", () => {
    mockMatchMedia(false);
    expect(systemPrefersDark()).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("returns an explicit 'light' preference verbatim", () => {
    mockMatchMedia(true); // system is dark, but explicit light wins
    expect(resolveTheme("light")).toBe("light");
  });

  it("returns an explicit 'dark' preference verbatim", () => {
    mockMatchMedia(false);
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves 'system' to 'dark' when the OS prefers dark", () => {
    mockMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("resolves 'system' to 'light' when the OS prefers light", () => {
    mockMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });
});

describe("applyTheme", () => {
  it("adds the .dark class for a dark resolution", () => {
    mockMatchMedia(true);
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the .dark class for a light resolution", () => {
    document.documentElement.classList.add("dark");
    mockMatchMedia(false);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
