import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer so the store actions don't hit tauri-plugin-sql. Only the
// functions our tested code paths call need real behavior; the rest are unused
// here (the store imports them but these tests don't exercise those paths).
vi.mock("@/lib/db", () => ({
  listThreads: vi.fn(async () => []),
  purgeEphemeralThreads: vi.fn(async () => {}),
  getSetting: vi.fn(async (key: string) =>
    key === "default_provider"
      ? "openai"
      : key === "default_model"
        ? "gpt-4o"
        : null,
  ),
  setSetting: vi.fn(async () => {}),
  SYSTEM_PROMPT_ADDENDUM_KEY: "system_prompt_addendum",
}));

import { useThreads } from "@/store/threads";
import { getSetting, setSetting } from "@/lib/db";
import { PROVIDERS } from "@/lib/providers";

beforeEach(() => {
  // Reset the singleton store to a clean draft state before each test.
  useThreads.setState({
    initialized: false,
    threads: [],
    currentThreadId: null,
    messages: [],
    defaultProvider: PROVIDERS[0].id,
    defaultModel: PROVIDERS[0].defaultModel,
    draftProvider: PROVIDERS[0].id,
    draftModel: PROVIDERS[0].defaultModel,
  });
  vi.clearAllMocks();
});

describe("default model in threads store", () => {
  it("init() loads the saved default and seeds the draft from it", async () => {
    await useThreads.getState().init();
    const s = useThreads.getState();
    expect(s.defaultProvider).toBe("openai");
    expect(s.defaultModel).toBe("gpt-4o");
    expect(s.draftProvider).toBe("openai");
    expect(s.draftModel).toBe("gpt-4o");
  });

  it("startNewChat() resets the draft to the cached default", () => {
    useThreads.setState({
      defaultProvider: "openai",
      defaultModel: "gpt-4o",
      draftProvider: "gemini",
      draftModel: "gemini-2.0-flash",
    });
    useThreads.getState().startNewChat();
    const s = useThreads.getState();
    expect(s.draftProvider).toBe("openai");
    expect(s.draftModel).toBe("gpt-4o");
  });

  it("setDefaultModel() persists both keys and updates state + draft", async () => {
    await useThreads
      .getState()
      .setDefaultModel("mistral", "mistral-large-latest");
    expect(setSetting).toHaveBeenCalledWith("default_provider", "mistral");
    expect(setSetting).toHaveBeenCalledWith(
      "default_model",
      "mistral-large-latest",
    );
    const s = useThreads.getState();
    expect(s.defaultProvider).toBe("mistral");
    expect(s.defaultModel).toBe("mistral-large-latest");
    // currentThreadId is null (a draft), so the live draft updates too.
    expect(s.draftProvider).toBe("mistral");
    expect(s.draftModel).toBe("mistral-large-latest");
  });
});

describe("critic model in threads store", () => {
  it("init() normalizes a reset critic (empty-string settings) back to null", async () => {
    // setCriticModel(null, null) persists "" for both keys; init() must read
    // those empty strings back as null so the critic falls back to the planner
    // model instead of leaking an invalid provider id (`""`).
    vi.mocked(getSetting).mockImplementation(async (key: string) =>
      key === "critic_provider" || key === "critic_model" ? "" : null,
    );
    await useThreads.getState().init();
    const s = useThreads.getState();
    expect(s.criticProvider).toBeNull();
    expect(s.criticModel).toBeNull();
  });
});
