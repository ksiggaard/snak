import { describe, it, expect } from "vitest";
import { deriveTitle, resolveDefault } from "@/store/threads";
import { PROVIDERS } from "@/lib/providers";

describe("deriveTitle", () => {
  it("returns a short message unchanged", () => {
    expect(deriveTitle("Hello there")).toBe("Hello there");
  });

  it("collapses runs of whitespace (incl. newlines/tabs) to single spaces", () => {
    expect(deriveTitle("a\n\nb\tc   d")).toBe("a b c d");
  });

  it("trims leading and trailing whitespace", () => {
    expect(deriveTitle("   padded   ")).toBe("padded");
  });

  it("falls back to 'New chat' for an empty string", () => {
    expect(deriveTitle("")).toBe("New chat");
  });

  it("falls back to 'New chat' for whitespace-only input", () => {
    expect(deriveTitle("   \n\t  ")).toBe("New chat");
  });

  it("keeps a string of exactly 48 chars untruncated", () => {
    const s = "x".repeat(48);
    const out = deriveTitle(s);
    expect(out).toBe(s);
    expect(out).not.toContain("…");
  });

  it("truncates a 49-char string to 48 chars plus an ellipsis", () => {
    const s = "y".repeat(49);
    const out = deriveTitle(s);
    expect(out).toBe(`${"y".repeat(48)}…`);
    expect([...out]).toHaveLength(49); // 48 chars + 1 ellipsis glyph
  });

  it("measures length after whitespace collapse, not before", () => {
    // 40 visible chars but lots of interior whitespace -> stays short.
    const s = "word ".repeat(8).trim().replace(/ /g, "    ");
    expect(deriveTitle(s)).toBe("word word word word word word word word");
  });
});

describe("resolveDefault", () => {
  it("uses the stored provider+model when both are present", () => {
    expect(resolveDefault("openai", "gpt-4o")).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("falls back to PROVIDERS[0] when the provider is missing", () => {
    expect(resolveDefault(null, "gpt-4o")).toEqual({
      provider: PROVIDERS[0].id,
      model: PROVIDERS[0].defaultModel,
    });
  });

  it("falls back to PROVIDERS[0] when the model is missing", () => {
    expect(resolveDefault("openai", null)).toEqual({
      provider: PROVIDERS[0].id,
      model: PROVIDERS[0].defaultModel,
    });
  });

  it("falls back to PROVIDERS[0] when both are missing", () => {
    expect(resolveDefault(null, null)).toEqual({
      provider: PROVIDERS[0].id,
      model: PROVIDERS[0].defaultModel,
    });
  });
});
