import { describe, it, expect, beforeEach } from "vitest";
import {
  clampSidebarWidth,
  getStoredSidebarWidth,
  storeSidebarWidth,
  getStoredSidebarOpen,
  storeSidebarOpen,
  getStoredSidebarMode,
  storeSidebarMode,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  SIDEBAR_DEFAULT,
} from "@/lib/layout";

beforeEach(() => {
  localStorage.clear();
});

describe("clampSidebarWidth", () => {
  it("keeps a width within range unchanged (rounded)", () => {
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(300.6)).toBe(301);
  });

  it("clamps below MIN and above MAX", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN - 50)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(SIDEBAR_MAX + 999)).toBe(SIDEBAR_MAX);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_DEFAULT);
    expect(clampSidebarWidth(Infinity)).toBe(SIDEBAR_DEFAULT);
  });
});

describe("sidebar width persistence", () => {
  it("defaults to SIDEBAR_DEFAULT when nothing is stored", () => {
    expect(getStoredSidebarWidth()).toBe(SIDEBAR_DEFAULT);
  });

  it("round-trips a stored width", () => {
    storeSidebarWidth(320);
    expect(getStoredSidebarWidth()).toBe(320);
  });

  it("clamps a stored width on read and write", () => {
    storeSidebarWidth(99999);
    expect(getStoredSidebarWidth()).toBe(SIDEBAR_MAX);
  });

  it("falls back to default for a corrupt stored value", () => {
    localStorage.setItem("sidebar-width", "not-a-number");
    expect(getStoredSidebarWidth()).toBe(SIDEBAR_DEFAULT);
  });
});

describe("sidebar open persistence", () => {
  it("defaults to open when nothing is stored", () => {
    expect(getStoredSidebarOpen()).toBe(true);
  });

  it("round-trips open/closed", () => {
    storeSidebarOpen(false);
    expect(getStoredSidebarOpen()).toBe(false);
    storeSidebarOpen(true);
    expect(getStoredSidebarOpen()).toBe(true);
  });
});

describe("sidebar mode persistence", () => {
  it("defaults to 'chats'", () => {
    expect(getStoredSidebarMode()).toBe("chats");
  });

  it("round-trips a mode", () => {
    storeSidebarMode("projects");
    expect(getStoredSidebarMode()).toBe("projects");
    storeSidebarMode("bots");
    expect(getStoredSidebarMode()).toBe("bots");
  });

  it("falls back to 'chats' for an unknown stored value", () => {
    localStorage.setItem("sidebar-mode", "bogus");
    expect(getStoredSidebarMode()).toBe("chats");
  });
});
