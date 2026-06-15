import { describe, expect, it } from "vitest";
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
import type { ProviderMeta } from "@/lib/providers";
import type { Model, Provider } from "@/types/db";

const provider = (id: Provider, label: string): ProviderMeta => ({
  id,
  label,
  defaultModel: "x",
  keyHint: "",
});

const model = (
  id: number,
  provider: Provider,
  model_id: string,
  label: string,
  sort_order = 0,
): Model => ({ id, provider, model_id, label, sort_order });

const providers = [provider("anthropic", "Anthropic"), provider("openai", "OpenAI")];
const models = [
  model(1, "anthropic", "claude-opus-4-8", "Opus 4.8", 0),
  model(2, "anthropic", "claude-sonnet-4-6", "Sonnet 4.6", 1),
  model(3, "openai", "gpt-4o", "GPT-4o", 0),
];

describe("buildModelOptions", () => {
  it("includes only keyed providers' models, formatted 'Provider - Label'", () => {
    const opts = buildModelOptions(providers, new Set(["anthropic"]), models, null);
    expect(opts.map((o) => o.display)).toEqual([
      "Anthropic - Opus 4.8",
      "Anthropic - Sonnet 4.6",
    ]);
    expect(opts.every((o) => o.active)).toBe(true);
  });

  it("excludes a keyed provider with no configured models", () => {
    const opts = buildModelOptions(providers, new Set(["openai"]), [models[0], models[1]], null);
    expect(opts).toEqual([]);
  });

  it("orders each provider's models by sort_order", () => {
    const reversed = [models[1], models[0]];
    const opts = buildModelOptions(providers, new Set(["anthropic"]), reversed, null);
    expect(opts.map((o) => o.modelId)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
  });

  it("prepends the current combo as an inert option when absent", () => {
    const opts = buildModelOptions(
      providers,
      new Set(["anthropic"]),
      models,
      { provider: "anthropic", model: "claude-opus-4-1" },
    );
    expect(opts[0]).toMatchObject({
      provider: "anthropic",
      modelId: "claude-opus-4-1",
      display: "Anthropic - claude-opus-4-1",
      active: false,
    });
    expect(opts).toHaveLength(3);
  });

  it("does not duplicate the current combo when it is already listed", () => {
    const opts = buildModelOptions(
      providers,
      new Set(["anthropic"]),
      models,
      { provider: "anthropic", model: "claude-opus-4-8" },
    );
    expect(opts).toHaveLength(2);
    expect(opts.every((o) => o.active)).toBe(true);
  });

  it("returns [] when nothing qualifies and there is no current combo", () => {
    expect(buildModelOptions(providers, new Set(), models, null)).toEqual([]);
  });

  it("marks cloud providers inactive with reason 'offline' when offline", () => {
    const opts = buildModelOptions(
      providers,
      new Set(["anthropic", "openai"]),
      models,
      null,
      true, // offline
    );
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => !o.active && o.reason === "offline")).toBe(true);
  });

  it("keeps the keyless local provider (ollama) active when offline", () => {
    const withOllama = [...providers, provider("ollama", "Local (Ollama)")];
    const withOllamaModels = [
      ...models,
      model(4, "ollama", "llama3.2:1b", "llama3.2:1b", 0),
    ];
    const opts = buildModelOptions(
      withOllama,
      new Set(["anthropic", "ollama"]),
      withOllamaModels,
      null,
      true, // offline
    );
    const ollama = opts.filter((o) => o.provider === "ollama");
    const cloud = opts.filter((o) => o.provider === "anthropic");
    expect(ollama.length).toBe(1);
    expect(ollama[0].active).toBe(true);
    expect(ollama[0].reason).toBeUndefined();
    expect(cloud.every((o) => !o.active && o.reason === "offline")).toBe(true);
  });
});

describe("currentModelLabel", () => {
  it("returns the model's friendly label and provider label", () => {
    expect(currentModelLabel(providers, models, "anthropic", "claude-opus-4-8")).toEqual({
      label: "Opus 4.8",
      providerLabel: "Anthropic",
    });
  });

  it("falls back to the raw model id and provider id when not found", () => {
    expect(currentModelLabel(providers, models, "anthropic", "claude-unknown")).toEqual({
      label: "claude-unknown",
      providerLabel: "Anthropic",
    });
    expect(currentModelLabel([], [], "mistral", "mistral-large-latest")).toEqual({
      label: "mistral-large-latest",
      providerLabel: "mistral",
    });
  });
});
