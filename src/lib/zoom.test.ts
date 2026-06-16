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
