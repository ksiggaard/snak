import { describe, it, expect } from "vitest";
import { PROVIDERS } from "@/lib/providers";
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
