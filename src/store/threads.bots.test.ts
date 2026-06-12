import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer so store actions don't hit tauri-plugin-sql. Only the
// functions the tested paths call need real behavior.
vi.mock("@/lib/db", () => ({
  listThreads: vi.fn(async () => []),
  purgeEphemeralThreads: vi.fn(async () => {}),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  createThread: vi.fn(),
  addMessage: vi.fn(async (input: { thread_id: string }) => ({
    id: "m1",
    kind: "normal",
    duration_ms: null,
    created_at: "",
    ...input,
  })),
  addAttachment: vi.fn(async () => ({})),
  addUsage: vi.fn(async () => {}),
  getProject: vi.fn(async () => null),
  listProjectFiles: vi.fn(async () => []),
  listUserMemory: vi.fn(async () => []),
  getBot: vi.fn(async () => null),
  listBotMemory: vi.fn(async () => []),
  SYSTEM_PROMPT_ADDENDUM_KEY: "system_prompt_addendum",
}));

vi.mock("@/lib/messages", () => ({
  loadThreadMessages: vi.fn(async () => []),
}));

// The provider stream is irrelevant here — resolve with an empty result so
// send() persists nothing after the user turn.
vi.mock("@/lib/chat", () => ({
  chatStream: vi.fn(async () => ({
    content: "",
    model: "",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    },
  })),
  cancelStream: vi.fn(async () => {}),
}));

import { useThreads } from "@/store/threads";
import {
  createThread,
  getBot,
  getProject,
  getSetting,
  listBotMemory,
} from "@/lib/db";
import { chatStream, type ApiMessage } from "@/lib/chat";
import { PROVIDERS } from "@/lib/providers";
import type { Bot, Thread } from "@/types/db";

const bot = (over: Partial<Bot>): Bot => ({
  id: "b1",
  name: "John",
  instructions: "Challenge the architecture.",
  avatar_media_type: null,
  avatar_data: null,
  default_provider: null,
  default_model: null,
  created_at: "2026-06-12 00:00:00",
  updated_at: "2026-06-12 00:00:00",
  ...over,
});

const thread = (over: Partial<Thread>): Thread => ({
  id: "t1",
  title: "A thread",
  provider: "anthropic",
  model: "m",
  project_id: null,
  favorite: 0,
  ephemeral: 0,
  archived: 0,
  bot_id: null,
  created_at: "2026-06-12 00:00:00",
  updated_at: "2026-06-12 00:00:00",
  ...over,
});

beforeEach(() => {
  useThreads.setState({
    initialized: false,
    threads: [],
    currentThreadId: null,
    messages: [],
    draftProjectId: null,
    draftIncognito: false,
    draftBotId: null,
    defaultProvider: PROVIDERS[0].id,
    defaultModel: PROVIDERS[0].defaultModel,
    draftProvider: PROVIDERS[0].id,
    draftModel: PROVIDERS[0].defaultModel,
    busy: false,
  });
  vi.clearAllMocks();
  vi.mocked(createThread).mockImplementation(
    async (input: {
      provider: Thread["provider"];
      model: string;
      title?: string;
      projectId?: string | null;
      ephemeral?: boolean;
      botId?: string | null;
    }) =>
      thread({
        id: "t-new",
        provider: input.provider,
        model: input.model,
        project_id: input.projectId ?? null,
        ephemeral: input.ephemeral ? 1 : 0,
        bot_id: input.botId ?? null,
      }),
  );
});

describe("startNewChatWithBot (T38)", () => {
  it("seeds the draft from the bot's default provider+model when both are set", () => {
    useThreads
      .getState()
      .startNewChatWithBot(
        bot({ default_provider: "openai", default_model: "gpt-4o" }),
      );
    const s = useThreads.getState();
    expect(s.draftBotId).toBe("b1");
    expect(s.draftProvider).toBe("openai");
    expect(s.draftModel).toBe("gpt-4o");
  });

  it("falls back to the app default when the bot has no default", () => {
    useThreads.setState({ defaultProvider: "mistral", defaultModel: "mx" });
    useThreads.getState().startNewChatWithBot(bot({}));
    const s = useThreads.getState();
    expect(s.draftProvider).toBe("mistral");
    expect(s.draftModel).toBe("mx");
  });

  it("falls back to the app default when only one default field is set", () => {
    useThreads.setState({ defaultProvider: "mistral", defaultModel: "mx" });
    useThreads
      .getState()
      .startNewChatWithBot(
        bot({ default_provider: "openai", default_model: null }),
      );
    let s = useThreads.getState();
    expect(s.draftProvider).toBe("mistral");
    expect(s.draftModel).toBe("mx");

    useThreads
      .getState()
      .startNewChatWithBot(
        bot({ default_provider: null, default_model: "gpt-4o" }),
      );
    s = useThreads.getState();
    expect(s.draftProvider).toBe("mistral");
    expect(s.draftModel).toBe("mx");
  });

  it("resets draftProjectId and draftIncognito", () => {
    useThreads.setState({ draftProjectId: "p1", draftIncognito: true });
    useThreads.getState().startNewChatWithBot(bot({}));
    const s = useThreads.getState();
    expect(s.draftProjectId).toBe(null);
    expect(s.draftIncognito).toBe(false);
    expect(s.currentThreadId).toBe(null);
  });

  it("startNewChat() clears the draft bot", () => {
    useThreads.setState({ draftBotId: "b1" });
    useThreads.getState().startNewChat();
    expect(useThreads.getState().draftBotId).toBe(null);
  });

  it("startNewChatInProject() clears the draft bot", () => {
    useThreads.setState({ draftBotId: "b1" });
    useThreads.getState().startNewChatInProject("p1");
    expect(useThreads.getState().draftBotId).toBe(null);
  });
});

describe("send() with a bot (T38)", () => {
  it("passes the draft bot id to createThread", async () => {
    useThreads.setState({ draftBotId: "b1" });
    await useThreads.getState().send("hello", []);
    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({ botId: "b1" }),
    );
    expect(useThreads.getState().error).toBe(null);
  });

  it("injects the bot system text between the global and project blocks", async () => {
    useThreads.setState({
      threads: [thread({ id: "t1", bot_id: "b1", project_id: "p1" })],
      currentThreadId: "t1",
    });
    vi.mocked(getBot).mockResolvedValue(bot({}));
    vi.mocked(listBotMemory).mockResolvedValue([
      {
        id: "bm1",
        bot_id: "b1",
        content: "Prefers TypeScript",
        created_at: "",
        updated_at: "",
      },
    ]);
    vi.mocked(getProject).mockResolvedValue({
      id: "p1",
      name: "Acme",
      instructions: "Project rule.",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getSetting).mockImplementation(async (key: string) =>
      key === "system_prompt_addendum" ? "Global rule." : null,
    );

    await useThreads.getState().send("hello", []);
    expect(useThreads.getState().error).toBe(null);

    const messages = vi.mocked(chatStream).mock.calls[0][2] as ApiMessage[];
    const systems = messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(3);
    expect(systems[0].content).toContain("Global rule.");
    expect(systems[1].content).toContain("You are John");
    expect(systems[1].content).toContain("Challenge the architecture.");
    expect(systems[1].content).toContain("- Prefers TypeScript");
    expect(systems[2].content).toContain("Project rule.");
  });

  it("skips the bot block when the thread has no bot", async () => {
    useThreads.setState({
      threads: [thread({ id: "t1" })],
      currentThreadId: "t1",
    });
    await useThreads.getState().send("hello", []);
    expect(getBot).not.toHaveBeenCalled();
    expect(useThreads.getState().error).toBe(null);
  });
});
