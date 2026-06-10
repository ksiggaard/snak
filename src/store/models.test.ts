import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  listModels: vi.fn(async () => [
    { id: 1, provider: "anthropic", model_id: "claude-opus-4-8", label: "Opus 4.8", sort_order: 0 },
  ]),
  addModel: vi.fn(async () => {}),
  deleteModel: vi.fn(async () => {}),
}));

import { useModels } from "@/store/models";
import { addModel, deleteModel } from "@/lib/db";

beforeEach(() => {
  useModels.setState({ models: [], loaded: false, error: null });
  vi.clearAllMocks();
});

describe("useModels", () => {
  it("load() populates models from the db", async () => {
    await useModels.getState().load();
    const s = useModels.getState();
    expect(s.loaded).toBe(true);
    expect(s.models).toHaveLength(1);
    expect(s.models[0].model_id).toBe("claude-opus-4-8");
  });

  it("add() calls the db helper then reloads", async () => {
    await useModels.getState().add("openai", "gpt-4o", "GPT-4o");
    expect(addModel).toHaveBeenCalledWith({
      provider: "openai",
      modelId: "gpt-4o",
      label: "GPT-4o",
    });
    expect(useModels.getState().models).toHaveLength(1);
  });

  it("remove() calls the db helper then reloads", async () => {
    await useModels.getState().remove(1);
    expect(deleteModel).toHaveBeenCalledWith(1);
    expect(useModels.getState().loaded).toBe(true);
  });
});
