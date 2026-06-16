import { describe, it, expect } from "vitest";
import { menuActionForKey } from "@/lib/menuActions";

// In jsdom, isMac is false (userAgent has no "Mac OS X"), so the modifier is
// Ctrl. These tests therefore use ctrlKey.
function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("menuActionForKey — zoom", () => {
  it("maps Ctrl+= and Ctrl++ to zoom-in", () => {
    expect(menuActionForKey(key({ key: "=", ctrlKey: true }))).toBe("zoom-in");
    expect(
      menuActionForKey(key({ key: "+", ctrlKey: true, shiftKey: true })),
    ).toBe("zoom-in");
  });

  it("maps Ctrl+- to zoom-out and Ctrl+0 to zoom-reset", () => {
    expect(menuActionForKey(key({ key: "-", ctrlKey: true }))).toBe("zoom-out");
    expect(menuActionForKey(key({ key: "0", ctrlKey: true }))).toBe(
      "zoom-reset",
    );
  });

  it("ignores the zoom keys without the modifier", () => {
    expect(menuActionForKey(key({ key: "=" }))).toBeNull();
    expect(menuActionForKey(key({ key: "0" }))).toBeNull();
  });

  it("still maps the existing letter shortcuts", () => {
    expect(menuActionForKey(key({ key: "n", ctrlKey: true }))).toBe("new-chat");
    expect(menuActionForKey(key({ key: "k", ctrlKey: true }))).toBe("search");
  });
});
