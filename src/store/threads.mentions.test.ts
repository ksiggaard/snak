import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer so store actions don't hit tauri-plugin-sql. Only the
// functions the tested paths call need real behavior.
vi.mock("@/lib/db", () => ({
  listThreads: vi.fn(async () => []),
  purgeEphemeralThreads: vi.fn(async () => {}),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  createThread: vi.fn(),
  addMessage: vi.fn(),
  addAttachment: vi.fn(async () => ({})),
  addUsage: vi.fn(async () => {}),
  getWorkspace: vi.fn(async () => null),
  listWorkspaceFiles: vi.fn(async () => []),
  listWorkspaceMemory: vi.fn(async () => []),
  listUserMemory: vi.fn(async () => []),
  getBot: vi.fn(async () => null),
  listBots: vi.fn(async () => []),
  listBotMemory: vi.fn(async () => []),
  SYSTEM_PROMPT_ADDENDUM_KEY: "system_prompt_addendum",
}));

// In-memory transcript: addMessage appends, loadThreadMessages snapshots —
// so a second persona's history naturally contains the first one's reply.
vi.mock("@/lib/messages", () => ({
  loadThreadMessages: vi.fn(async () => []),
}));

vi.mock("@/lib/chat", () => ({
  chatStream: vi.fn(),
  cancelStream: vi.fn(async () => {}),
}));

// The T40 memory-review runner is fire-and-forget from send(); mock it so
// these tests only assert whether (and with what) it was invoked.
vi.mock("@/lib/personaMemory", () => ({
  runPersonaMemoryUpdate: vi.fn(async () => {}),
}));

import { useThreads } from "@/store/threads";
import {
  addMessage,
  createThread,
  getBot,
  listBots,
  listBotMemory,
} from "@/lib/db";
import { chatStream, type ApiMessage } from "@/lib/chat";
import type { Message, MessageKind } from "@/types/db";
import { loadThreadMessages, type MessageView } from "@/lib/messages";
import { runPersonaMemoryUpdate } from "@/lib/personaMemory";
import { PROVIDERS } from "@/lib/providers";
import type { Bot, Thread } from "@/types/db";

const bot = (over: Partial<Bot>): Bot => ({
  id: "b1",
  name: "John",
  tagline: "",
  instructions: "Challenge the architecture.",
  modus_operandi: "",
  tone_of_voice: "",
  auto_memory: 1,
  mood_enabled: 1,
  mood: "",
  avatar_media_type: null,
  avatar_data: null,
  default_provider: null,
  default_model: null,
  starters: "",
  created_at: "2026-06-13 00:00:00",
  updated_at: "2026-06-13 00:00:00",
  ...over,
});

const john = bot({ id: "b1", name: "John" });
const maria = bot({
  id: "b2",
  name: "Maria",
  instructions: "Care about healthy food.",
});

const thread = (over: Partial<Thread>): Thread => ({
  id: "t1",
  title: "A thread",
  provider: "anthropic",
  model: "m",
  workspace_id: null,
  favorite: 0,
  ephemeral: 0,
  archived: 0,
  deep_research: 0,
  output_type: "default",
  bot_id: null,
  workspace_files_excluded: null,
  planner_active: 0,
  pre_planner_provider: null,
  pre_planner_model: null,
  created_at: "2026-06-13 00:00:00",
  updated_at: "2026-06-13 00:00:00",
  ...over,
});

/** The transcript backing the loadThreadMessages/addMessage mocks. */
let rows: MessageView[];

const reply = (content: string) => ({
  content,
  model: "m",
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  },
});

beforeEach(() => {
  useThreads.setState({
    initialized: false,
    threads: [thread({ id: "t1" })],
    currentThreadId: "t1",
    messages: [],
    draftWorkspaceId: null,
    draftIncognito: false,
    draftBotId: null,
    defaultProvider: PROVIDERS[0].id,
    defaultModel: PROVIDERS[0].defaultModel,
    draftProvider: PROVIDERS[0].id,
    draftModel: PROVIDERS[0].defaultModel,
    runningStreams: new Set(),
    cancelling: false,
  });
  vi.clearAllMocks();
  rows = [];
  vi.mocked(loadThreadMessages).mockImplementation(async () => [...rows]);
  vi.mocked(addMessage).mockImplementation(
    async (input) => {
      const id = `m${rows.length + 1}`;
      const m: Message = {
        id,
        thread_id: input.thread_id,
        role: input.role,
        content: input.content,
        kind: (input.kind as MessageKind) ?? "normal",
        duration_ms: input.duration_ms ?? null,
        bot_id: input.bot_id ?? null,
        variant_group:
          input.variant_group !== undefined
            ? input.variant_group
            : input.role === "assistant"
              ? id
              : null,
        variant_selected: 1,
        provider: input.provider ?? null,
        model: input.model ?? null,
        output_type: input.output_type ?? null,
        created_at: "2026-06-13 00:00:00",
      };
      rows.push({
        ...m,
        images: [],
        documents: [],
        toolCalls: [],
        subagents: [],
      });
      return m;
    },
  );
  vi.mocked(listBots).mockResolvedValue([john, maria]);
  vi.mocked(chatStream).mockResolvedValue(reply("Hi!"));
  vi.mocked(createThread).mockImplementation(
    async (input: { provider: Thread["provider"]; model: string }) =>
      thread({ id: "t-new", provider: input.provider, model: input.model }),
  );
});

describe("send() with @-mentions (T43)", () => {
  it("persists the mentioned persona's reply with its bot_id", async () => {
    await useThreads.getState().send("@John what do you think?", []);
    expect(useThreads.getState().error).toBe(null);

    const calls = vi.mocked(addMessage).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2); // user turn + one persona reply
    expect(calls[0]).toMatchObject({
      role: "user",
      content: "@John what do you think?",
    });
    expect(calls[1]).toMatchObject({ role: "assistant", bot_id: "b1" });
  });

  it("injects the mentioned persona's system block, not the thread persona's", async () => {
    useThreads.setState({
      threads: [thread({ id: "t1", bot_id: "b2" })], // thread belongs to Maria
      currentThreadId: "t1",
    });
    vi.mocked(listBotMemory).mockResolvedValue([
      {
        id: "bm1",
        bot_id: "b1",
        content: "Prefers TypeScript",
        source: "user",
        created_at: "",
        updated_at: "",
      },
    ]);

    await useThreads.getState().send("@John weigh in", []);
    expect(useThreads.getState().error).toBe(null);

    const history = vi.mocked(chatStream).mock.calls[0][2] as ApiMessage[];
    const systems = history.filter((m) => m.role === "system");
    expect(systems).toHaveLength(1);
    expect(systems[0].content).toContain("You are John");
    expect(systems[0].content).toContain("- Prefers TypeScript");
    expect(systems[0].content).not.toContain("Maria");
    // The mention replaces the thread persona for this exchange.
    expect(getBot).not.toHaveBeenCalled();
    expect(listBotMemory).toHaveBeenCalledWith("b1");
  });

  it("answers all mentioned personas sequentially, later ones seeing earlier replies", async () => {
    let n = 0;
    vi.mocked(chatStream).mockImplementation(async () => reply(`R${++n}`));

    await useThreads.getState().send("@John @Maria thoughts?", []);
    expect(useThreads.getState().error).toBe(null);

    expect(chatStream).toHaveBeenCalledTimes(2);
    const assistant = vi
      .mocked(addMessage)
      .mock.calls.map((c) => c[0])
      .filter((m) => m.role === "assistant");
    expect(assistant.map((m) => m.bot_id)).toEqual(["b1", "b2"]);
    expect(assistant.map((m) => m.content)).toEqual(["R1", "R2"]);

    // Maria's history contains John's persisted reply.
    const second = vi.mocked(chatStream).mock.calls[1][2] as ApiMessage[];
    expect(
      second.some((m) => m.role === "assistant" && m.content === "R1"),
    ).toBe(true);
    // John's history did not contain any assistant turn yet.
    const first = vi.mocked(chatStream).mock.calls[0][2] as ApiMessage[];
    expect(first.some((m) => m.role === "assistant")).toBe(false);
  });

  it("uses the thread's provider/model for every reply (persona defaults ignored)", async () => {
    vi.mocked(listBots).mockResolvedValue([
      { ...john, default_provider: "openai", default_model: "gpt-4o" },
    ]);
    await useThreads.getState().send("@John hello", []);
    expect(chatStream).toHaveBeenCalledWith(
      "anthropic",
      "m",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      false,
    );
  });

  it("Stop cancels the remaining persona queue", async () => {
    vi.mocked(chatStream).mockImplementation(async () => {
      // Simulate the user pressing Stop during the first reply.
      useThreads.setState({ cancelling: true });
      return reply("partial");
    });

    await useThreads.getState().send("@John @Maria thoughts?", []);
    expect(chatStream).toHaveBeenCalledTimes(1);
    // The in-flight partial is still persisted via the normal path.
    const assistant = vi
      .mocked(addMessage)
      .mock.calls.map((c) => c[0])
      .filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(useThreads.getState().runningStreams.size).toBe(0);
  });

  it("runs the T40 memory review per mentioned persona", async () => {
    await useThreads.getState().send("@John @Maria thoughts?", []);
    expect(runPersonaMemoryUpdate).toHaveBeenCalledTimes(2);
    expect(runPersonaMemoryUpdate).toHaveBeenCalledWith(
      john,
      "@John @Maria thoughts?",
      "Hi!",
      "anthropic",
      "m",
    );
    expect(runPersonaMemoryUpdate).toHaveBeenCalledWith(
      maria,
      "@John @Maria thoughts?",
      "Hi!",
      "anthropic",
      "m",
    );
  });

  it("skips the memory review on incognito threads and honors per-persona toggles", async () => {
    useThreads.setState({
      threads: [thread({ id: "t1", ephemeral: 1 })],
      currentThreadId: "t1",
    });
    await useThreads.getState().send("@John hi", []);
    expect(runPersonaMemoryUpdate).not.toHaveBeenCalled();

    useThreads.setState({
      threads: [thread({ id: "t1" })],
      currentThreadId: "t1",
    });
    vi.mocked(listBots).mockResolvedValue([
      { ...john, auto_memory: 0, mood_enabled: 0 },
    ]);
    await useThreads.getState().send("@John hi again", []);
    expect(runPersonaMemoryUpdate).not.toHaveBeenCalled();
  });

  it("an unknown @name sends as a plain message (single reply, no bot_id)", async () => {
    await useThreads.getState().send("@Nobody hello", []);
    expect(useThreads.getState().error).toBe(null);
    expect(chatStream).toHaveBeenCalledTimes(1);
    const assistant = vi
      .mocked(addMessage)
      .mock.calls.map((c) => c[0])
      .filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0].bot_id ?? null).toBe(null);
  });

  it("an email-style @ never triggers the mention path", async () => {
    await useThreads.getState().send("mail kasper@example.com please", []);
    expect(chatStream).toHaveBeenCalledTimes(1);
    const history = vi.mocked(chatStream).mock.calls[0][2] as ApiMessage[];
    expect(history.some((m) => m.role === "system")).toBe(false);
  });

  it("a bare @Name with no question still gets a reply", async () => {
    await useThreads.getState().send("@John", []);
    const assistant = vi
      .mocked(addMessage)
      .mock.calls.map((c) => c[0])
      .filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0].bot_id).toBe("b1");
  });
});
