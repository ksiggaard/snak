import { describe, expect, it } from "vitest";
import {
  audioEnabled,
  buildRegistry,
  hasRenderer,
  parseManifest,
} from "@/lib/plugins";
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

  it("accepts a free-form category but rejects a blank one", () => {
    // Category is now a display label (behaviour comes from code), so a
    // previously-"unknown" value is accepted...
    expect(parseManifest({ ...valid, category: "wizardry" }).category).toBe(
      "wizardry",
    );
    // ...but it must still be present.
    expect(() => parseManifest({ ...valid, category: "  " })).toThrow(
      /`category`/,
    );
  });

  it("parses runtime fields (entry, permissions, dependencies)", () => {
    const m = parseManifest({
      ...valid,
      category: "extension",
      entry: "main.js",
      permissions: ["ui", "storage", 42],
      dependencies: [{ id: "com.example.dep", minVersion: "1.2.0" }, { bad: 1 }],
    });
    expect(m.entry).toBe("main.js");
    expect(m.permissions).toEqual(["ui", "storage"]); // non-strings dropped
    expect(m.dependencies).toEqual([
      { id: "com.example.dep", minVersion: "1.2.0" },
    ]); // malformed dep row dropped
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
      mk("slash-command", true, { command: "/t", description: "d" }),
      mk("renderer", true, { language: "mermaid" }),
    ]);
    expect(reg.providers.map((p) => p.id)).toEqual(["anthropic"]);
    expect(reg.themes).toHaveLength(1);
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

describe("audioEnabled", () => {
  const audioPlugin = (enabled: boolean): PluginInfo => ({
    source: "builtin",
    enabled,
    manifest: {
      id: "com.snak.audio",
      name: "Audio",
      version: "1.0.0",
      category: "audio",
      apiVersion: 1,
      contributes: { tts: true, stt: true } as never,
    },
  });

  it("is true only when an audio plugin is enabled", () => {
    expect(audioEnabled(buildRegistry([audioPlugin(true)]))).toBe(true);
    expect(audioEnabled(buildRegistry([audioPlugin(false)]))).toBe(false);
    expect(audioEnabled(buildRegistry([]))).toBe(false);
  });
});
