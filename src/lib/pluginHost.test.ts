import { describe, it, expect, beforeEach, vi } from "vitest";
import { contextFor, teardownPlugin } from "@/lib/pluginHost";
import { useContributions } from "@/store/contributions";
import type { PluginManifest } from "@/types/plugins";

const manifest = (permissions: string[]): PluginManifest => ({
  id: "com.test.x",
  name: "Test",
  version: "1.0.0",
  category: "extension",
  apiVersion: 1,
  entry: "main.js",
  permissions,
});

beforeEach(() => {
  useContributions.setState({
    renderers: {},
    uiSlots: {},
    llmHooks: [],
  });
});

describe("contextFor permission gating", () => {
  it("registers UI into the store when 'ui' is granted", () => {
    const ctx = contextFor(manifest(["ui"]));
    ctx.ui.registerUi("header", () => {});
    const items = useContributions.getState().uiSlots["header"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].pluginId).toBe("com.test.x");
  });

  it("ignores UI registration (with a warning) without 'ui'", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = contextFor(manifest([]));
    ctx.ui.registerUi("header", () => {});
    expect(useContributions.getState().uiSlots["header"]).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("exposes storage/llm only when declared", () => {
    expect(contextFor(manifest(["storage"])).storage).toBeDefined();
    expect(contextFor(manifest([])).storage).toBeUndefined();
    expect(contextFor(manifest(["llm-hook"])).llm).toBeDefined();
    expect(contextFor(manifest([])).llm).toBeUndefined();
  });

  it("registers a renderer keyed by lowercased language", () => {
    const ctx = contextFor(manifest(["ui"]));
    ctx.ui.registerRenderer("MerMaid", () => {});
    expect(useContributions.getState().renderers["mermaid"]?.pluginId).toBe(
      "com.test.x",
    );
  });
});

describe("teardownPlugin", () => {
  it("drops the plugin's contributions and runs onDisable handlers", () => {
    const ctx = contextFor(manifest(["ui"]));
    const cleanup = vi.fn();
    ctx.onDisable(cleanup);
    ctx.ui.registerUi("header", () => {});
    expect(useContributions.getState().uiSlots["header"]).toHaveLength(1);

    teardownPlugin("com.test.x");
    expect(useContributions.getState().uiSlots["header"]).toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
