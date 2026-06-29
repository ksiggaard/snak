import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  FALLBACK_PROVIDERS,
  KNOWN_PROVIDER_IDS,
  isKeylessProvider,
  providersFromContributions,
  selectActiveProviders,
  withKeylessProviders,
  type ProviderMeta,
} from "@/lib/providers";
import type { ProviderContribution } from "@/types/plugins";
import type { Provider } from "@/types/db";

describe("PROVIDERS registry", () => {
  it("is just the keyless local built-in (Ollama) — cloud providers are user-added", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["ollama"]);
    expect(KNOWN_PROVIDER_IDS).toEqual(["ollama"]);
  });

  it("uses unique ids", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every provider a non-empty label and defaultModel, and every keyed provider a keyHint", () => {
    for (const p of PROVIDERS) {
      expect(p.label.trim()).not.toBe("");
      expect(p.defaultModel.trim()).not.toBe("");
      // Keyless providers (ollama) have no key input, so no hint.
      if (!isKeylessProvider(p.id)) expect(p.keyHint.trim()).not.toBe("");
    }
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

describe("providersFromContributions (registry derivation)", () => {
  it("maps enabled provider contributions to ProviderMeta", () => {
    const out = providersFromContributions([
      contrib("ollama", { label: "Local (Ollama)", defaultModel: "llama3.2" }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["ollama"]);
    expect(out[0]).toEqual({
      id: "ollama",
      label: "Local (Ollama)",
      defaultModel: "llama3.2",
      keyHint: "hint",
    });
  });

  it("returns [] when no providers are contributed (all disabled)", () => {
    expect(providersFromContributions([])).toEqual([]);
  });

  it("drops ids the Rust dispatch doesn't know by id (only ollama is known)", () => {
    const out = providersFromContributions([
      contrib("ollama"),
      contrib("anthropic"), // a cloud provider is no longer a known built-in id
    ]);
    expect(out.map((p) => p.id)).toEqual(["ollama"]);
  });

  it("de-dupes by id (first contribution wins)", () => {
    const out = providersFromContributions([
      contrib("ollama", { label: "First" }),
      contrib("ollama", { label: "Second" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("First");
  });
});

describe("selectActiveProviders (load-state + fallback)", () => {
  it("returns the built-in fallback before the plugin layer has loaded", () => {
    expect(selectActiveProviders(false, [])).toBe(FALLBACK_PROVIDERS);
    // Even if (somehow) contributions are present, not-loaded uses the fallback.
    expect(selectActiveProviders(false, [contrib("ollama")])).toBe(
      FALLBACK_PROVIDERS,
    );
  });

  it("returns the enabled providers once loaded", () => {
    const out = selectActiveProviders(true, [contrib("ollama")]);
    expect(out.map((p) => p.id)).toEqual(["ollama"]);
  });

  it("returns [] (all-disabled) when loaded with no enabled providers", () => {
    expect(selectActiveProviders(true, [])).toEqual([]);
  });
});

describe("keyless providers", () => {
  const meta = (id: Provider): ProviderMeta => ({
    id,
    label: id,
    defaultModel: "m",
    keyHint: "",
  });

  it("isKeylessProvider knows ollama and nothing else", () => {
    expect(isKeylessProvider("ollama")).toBe(true);
    for (const id of ["anthropic", "openai", "groq", "nope"]) {
      expect(isKeylessProvider(id)).toBe(false);
    }
  });

  it("withKeylessProviders unions the keyless built-in (ollama) into the presence set", () => {
    const present = new Set<Provider>(["anthropic"]);
    const out = withKeylessProviders(present, [meta("ollama")]);
    expect([...out].sort()).toEqual(["anthropic", "ollama"]);
    // Pure: the input set is untouched.
    expect([...present]).toEqual(["anthropic"]);
  });

  it("treats every custom provider as available, key or not", () => {
    // With no built-in keyed providers left, any id other than the keyless
    // built-in (ollama) is a custom entry — key-optional, so always available.
    const out = withKeylessProviders(new Set<Provider>(), [
      meta("anthropic"), // user-added (canonical id reused) → available
      meta("groq"), // user-added → available
    ]);
    expect([...out].sort()).toEqual(["anthropic", "groq"]);
  });
});
