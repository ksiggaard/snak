import { describe, expect, it } from "vitest";
import { validateAccelerator } from "@/lib/shortcut";

describe("validateAccelerator", () => {
  it("accepts the default and common combos", () => {
    expect(validateAccelerator("Alt+Space")).toBeNull();
    expect(validateAccelerator("CommandOrControl+Shift+K")).toBeNull();
    expect(validateAccelerator("Ctrl+Alt+F12")).toBeNull();
    expect(validateAccelerator("Super+1")).toBeNull();
    expect(validateAccelerator(" alt + space ")).toBeNull(); // whitespace/casing
  });

  it("requires a modifier", () => {
    expect(validateAccelerator("Space")).not.toBeNull();
    expect(validateAccelerator("K")).not.toBeNull();
    expect(validateAccelerator("")).not.toBeNull();
  });

  it("rejects a trailing modifier or unknown key", () => {
    expect(validateAccelerator("Alt+Ctrl")).not.toBeNull();
    expect(validateAccelerator("Alt+Nope")).not.toBeNull();
    expect(validateAccelerator("Bogus+Space")).not.toBeNull();
    expect(validateAccelerator("Ctrl+F25")).not.toBeNull();
  });
});
