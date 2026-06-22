import { describe, it, expect } from "vitest";
import { buildMapsSystemText } from "@/lib/maps";
import type { HostRegistry } from "@/lib/plugins";

const registry = (languages: string[]): HostRegistry => ({
  providers: [],
  themes: [],
  skills: [],
  slashCommands: [],
  renderers: languages.map((language) => ({ language })),
  audio: [],
});

describe("buildMapsSystemText", () => {
  it("returns empty string when the maps renderer is disabled", () => {
    expect(buildMapsSystemText(registry([]))).toBe("");
    expect(buildMapsSystemText(registry(["mermaid"]))).toBe("");
  });

  it("returns the map instruction when the map renderer is enabled", () => {
    const out = buildMapsSystemText(registry(["map"]));
    expect(out).toContain("## Maps");
    expect(out).toContain("`map`");
    expect(out).toContain("snap");
    // Real places must be located by address (geocoded), not guessed coordinates.
    expect(out).toContain("properties.address");
  });

  it("matches the renderer language case-insensitively", () => {
    expect(buildMapsSystemText(registry(["Map"]))).toContain("## Maps");
  });
});
