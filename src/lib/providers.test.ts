import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  FALLBACK_PROVIDERS,
  providersFromContributions,
  selectActiveProviders,
} from "@/lib/providers";
import type { ProviderContribution } from "@/types/plugins";
import type { Provider } from "@/types/db";

const EXPECTED_IDS: Provider[] = ["anthropic", "openai", "mistral", "gemini"];

describe("PROVIDERS registry", () => {
  it("lists exactly the four supported providers, in order", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(EXPECTED_IDS);
  });

  it("uses unique ids", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every provider a non-empty label, defaultModel and keyHint", () => {
    for (const p of PROVIDERS) {
      expect(p.label.trim()).not.toBe("");
      expect(p.defaultModel.trim()).not.toBe("");
      expect(p.keyHint.trim()).not.toBe("");
    }
  });

  it("has Anthropic first (the default provider for new threads)", () => {
    expect(PROVIDERS[0].id).toBe("anthropic");
  });
});

const contrib = (
  id: string,
  over: Partial<ProviderContribution> = {},
): ProviderContribution => ({
  id,
  label: `${id} label`,
  defaultModel: `${id}-model`,
  keyHint: "hint",
  ...over,
});

describe("providersFromContributions (T18 registry derivation)", () => {
  it("maps enabled provider contributions to ProviderMeta", () => {
    const out = providersFromContributions([
      contrib("anthropic", { label: "Anthropic", defaultModel: "claude-x" }),
      contrib("openai"),
    ]);
    expect(out.map((p) => p.id)).toEqual(["anthropic", "openai"]);
    expect(out[0]).toEqual({
      id: "anthropic",
      label: "Anthropic",
      defaultModel: "claude-x",
      keyHint: "hint",
    });
  });

  it("returns [] when no providers are contributed (all disabled)", () => {
    expect(providersFromContributions([])).toEqual([]);
  });

  it("drops ids the Rust dispatch doesn't know (undispatchable)", () => {
    const out = providersFromContributions([
      contrib("anthropic"),
      contrib("totally-made-up"),
    ]);
    expect(out.map((p) => p.id)).toEqual(["anthropic"]);
  });

  it("de-dupes by id (first contribution wins)", () => {
    const out = providersFromContributions([
      contrib("openai", { label: "First" }),
      contrib("openai", { label: "Second" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("First");
  });
});

describe("selectActiveProviders (load-state + fallback)", () => {
  it("returns the hardcoded four before the plugin layer has loaded", () => {
    expect(selectActiveProviders(false, [])).toBe(FALLBACK_PROVIDERS);
    // Even if (somehow) contributions are present, not-loaded uses the fallback.
    expect(selectActiveProviders(false, [contrib("openai")])).toBe(
      FALLBACK_PROVIDERS,
    );
  });

  it("returns the enabled providers once loaded", () => {
    const out = selectActiveProviders(true, [
      contrib("gemini"),
      contrib("mistral"),
    ]);
    expect(out.map((p) => p.id)).toEqual(["gemini", "mistral"]);
  });

  it("returns [] (all-disabled) when loaded with no enabled providers", () => {
    expect(selectActiveProviders(true, [])).toEqual([]);
  });
});
