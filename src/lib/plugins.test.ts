import { describe, expect, it } from "vitest";
import { buildRegistry, hasRenderer, parseManifest } from "@/lib/plugins";
import type { PluginInfo } from "@/types/plugins";

const valid = {
  id: "com.example.x",
  name: "X",
  version: "1.0.0",
  category: "theme",
  apiVersion: 1,
  enabledByDefault: true,
};

describe("parseManifest", () => {
  it("parses a valid manifest", () => {
    const m = parseManifest(valid);
    expect(m.id).toBe("com.example.x");
    expect(m.category).toBe("theme");
    expect(m.enabledByDefault).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest("nope")).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() => parseManifest({ ...valid, category: "wizardry" })).toThrow(
      /unknown plugin category/,
    );
  });

  it("rejects a missing/blank id", () => {
    expect(() => parseManifest({ ...valid, id: "  " })).toThrow(/`id`/);
  });

  it("rejects a mismatched apiVersion", () => {
    expect(() => parseManifest({ ...valid, apiVersion: 999 })).toThrow(
      /apiVersion/,
    );
  });

  it("defaults enabledByDefault to false when absent", () => {
    const { enabledByDefault, ...rest } = valid;
    void enabledByDefault;
    expect(parseManifest(rest).enabledByDefault).toBe(false);
  });
});

describe("buildRegistry", () => {
  const mk = (
    category: PluginInfo["manifest"]["category"],
    enabled: boolean,
    contributes: object,
  ): PluginInfo => ({
    source: "builtin",
    enabled,
    manifest: {
      id: `id-${category}-${enabled}`,
      name: "n",
      version: "1.0.0",
      category,
      apiVersion: 1,
      contributes: contributes as never,
    },
  });

  it("includes only enabled plugins, grouped by category", () => {
    const reg = buildRegistry([
      mk("provider", true, {
        id: "anthropic",
        label: "Anthropic",
        defaultModel: "m",
        keyHint: "k",
      }),
      mk("provider", false, {
        id: "openai",
        label: "OpenAI",
        defaultModel: "m",
        keyHint: "k",
      }),
      mk("theme", true, { name: "Dark", css: ":root{}" }),
      mk("skill", true, { name: "S", instructions: "do" }),
      mk("slash-command", true, { command: "/t", description: "d" }),
      mk("renderer", true, { language: "mermaid" }),
    ]);
    expect(reg.providers.map((p) => p.id)).toEqual(["anthropic"]);
    expect(reg.themes).toHaveLength(1);
    expect(reg.skills).toHaveLength(1);
    expect(reg.slashCommands).toHaveLength(1);
    expect(reg.renderers.map((r) => r.language)).toEqual(["mermaid"]);
  });

  it("skips enabled plugins with no contribution", () => {
    const p = mk("provider", true, {});
    p.manifest.contributes = undefined;
    expect(buildRegistry([p]).providers).toHaveLength(0);
  });
});

describe("hasRenderer", () => {
  const reg = buildRegistry([
    {
      source: "builtin",
      enabled: true,
      manifest: {
        id: "com.snak.mermaid",
        name: "Mermaid",
        version: "1.0.0",
        category: "renderer",
        apiVersion: 1,
        contributes: { language: "Mermaid" } as never,
      },
    },
  ]);

  it("matches the contributed language case-insensitively", () => {
    expect(hasRenderer(reg, "mermaid")).toBe(true);
    expect(hasRenderer(reg, "MERMAID")).toBe(true);
  });

  it("is false for a language no renderer contributes", () => {
    expect(hasRenderer(reg, "plantuml")).toBe(false);
    expect(hasRenderer(buildRegistry([]), "mermaid")).toBe(false);
  });
});
