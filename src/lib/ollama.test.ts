import { describe, expect, it } from "vitest";
import {
  formatBytes,
  isValidOllamaModelName,
  ollamaPullCommand,
  reconcileOllamaModels,
  SUGGESTED_MODELS,
} from "@/lib/ollama";
import type { Model } from "@/types/db";

const model = (
  id: number,
  provider: Model["provider"],
  modelId: string,
): Model => ({
  id,
  provider,
  model_id: modelId,
  label: modelId,
  sort_order: 0,
  notes: "",
});

describe("isValidOllamaModelName", () => {
  it.each([
    "llama3.2:1b",
    "qwen2.5:0.5b",
    "mistral",
    "hf.co/org/repo",
    "hf.co/org/repo:Q4_K_M",
  ])("accepts %s", (name) => {
    expect(isValidOllamaModelName(name)).toBe(true);
  });

  it.each([
    "",
    " ",
    "llama 3",
    "llama3;rm -rf /",
    "a && b",
    "$(whoami)",
    "name|pipe",
    "`tick`",
    "/leading-slash",
    "trailing-colon:",
    "-leading-dash",
  ])("rejects %j", (name) => {
    expect(isValidOllamaModelName(name)).toBe(false);
  });
});

describe("ollamaPullCommand", () => {
  it("builds the staged pull command", () => {
    expect(ollamaPullCommand("llama3.2:1b")).toBe("ollama pull llama3.2:1b");
  });
});

describe("reconcileOllamaModels", () => {
  it("adds installed models that have no ollama row", () => {
    const { toAdd, toRemove } = reconcileOllamaModels(
      [model(1, "ollama", "llama3.2:1b")],
      ["llama3.2:1b", "qwen2.5:0.5b"],
    );
    expect(toAdd).toEqual(["qwen2.5:0.5b"]);
    expect(toRemove).toEqual([]);
  });

  it("removes ollama rows that are no longer installed", () => {
    const stale = model(2, "ollama", "gone:1b");
    const { toAdd, toRemove } = reconcileOllamaModels(
      [model(1, "ollama", "llama3.2:1b"), stale],
      ["llama3.2:1b"],
    );
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([stale]);
  });

  it("never touches other providers' rows", () => {
    const { toAdd, toRemove } = reconcileOllamaModels(
      [model(1, "anthropic", "claude-opus-4-8"), model(2, "openai", "gpt-4o")],
      [],
    );
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });

  it("is a no-op when rows and installed list already match", () => {
    const { toAdd, toRemove } = reconcileOllamaModels(
      [
        model(1, "ollama", "llama3.2:1b"),
        model(2, "anthropic", "claude-opus-4-8"),
      ],
      ["llama3.2:1b"],
    );
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });
});

describe("SUGGESTED_MODELS", () => {
  it("every curated name is a valid, shell-safe model name", () => {
    // Suggestions are staged into `ollama pull <name>`, so an invalid name
    // would be both broken and a (theoretical) injection vector.
    for (const s of SUGGESTED_MODELS) {
      expect(isValidOllamaModelName(s.name), s.name).toBe(true);
    }
  });

  it("includes a Hugging Face (hf.co) example per the idea", () => {
    expect(SUGGESTED_MODELS.some((s) => s.name.startsWith("hf.co/"))).toBe(
      true,
    );
  });
});

describe("formatBytes", () => {
  it("formats across unit boundaries", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(42_000_000)).toBe("42 MB");
    expect(formatBytes(1_340_000_000)).toBe("1.3 GB");
  });
});
