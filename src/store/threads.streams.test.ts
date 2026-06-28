import { beforeEach, describe, expect, it, vi } from "vitest";

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
  setThreadProviderModel: vi.fn(async () => {}),
  setThreadPlannerActive: vi.fn(async () => {}),
  restoreThreadPrePlannerModel: vi.fn(async () => {}),
  SYSTEM_PROMPT_ADDENDUM_KEY: "system_prompt_addendum",
  LAST_THREAD_KEY: "last_thread_id",
  CRITIC_PROVIDER_KEY: "critic_provider",
  CRITIC_MODEL_KEY: "critic_model",
  setThreadDeepResearch: vi.fn(async () => {}),
  setThreadWorkspaceFilesExcluded: vi.fn(async () => {}),
  setThreadArchived: vi.fn(async () => {}),
}));

vi.mock("@/lib/messages", async (importOriginal) => {
  // Keep the real stream-event helpers (applyToolEvent, isModelOutput, …) the
  // send path calls from onDelta; only loadThreadMessages is stubbed.
  const actual = await importOriginal<typeof import("@/lib/messages")>();
  return { ...actual, loadThreadMessages: vi.fn(async () => []) };
});

vi.mock("@/store/connectivity", () => ({
  useConnectivity: { getState: () => ({ status: "online" as const, forceOffline: false }) },
  deriveOffline: () => false,
}));

vi.mock("@/lib/chat", () => ({
  chatStream: vi.fn(),
  cancelStream: vi.fn(async () => {}),
}));

vi.mock("@/lib/personaMemory", () => ({
  runPersonaMemoryUpdate: vi.fn(async () => {}),
}));

import { useThreads } from "@/store/threads";
import { addMessage, createThread } from "@/lib/db";
import { chatStream, type ChatResult } from "@/lib/chat";
import { loadThreadMessages, type MessageView } from "@/lib/messages";
import { PROVIDERS } from "@/lib/providers";
import type { Message, Thread } from "@/types/db";

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
  bot_id: null,
  workspace_files_excluded: null,
  planner_active: 0,
  pre_planner_provider: null,
  pre_planner_model: null,
  created_at: "2026-06-13 00:00:00",
  updated_at: "2026-06-13 00:00:00",
  ...over,
});

function msg(
  thread_id: string,
  role: "user" | "assistant",
  content: string,
): MessageView {
  return {
    id: `m_${content.slice(0, 4)}`,
    thread_id,
    role,
    content,
    kind: "normal",
    duration_ms: null,
    bot_id: null,
    variant_group: null,
    variant_selected: 1,
    created_at: "2026-06-13 00:00:00",
    provider: "anthropic",
    model: "m",
    images: [],
    documents: [],
    toolCalls: [],
    subagents: [],
  };
}

const reply = (content: string) => ({
  content,
  model: "m",
  usage: { input_tokens: 1, output_tokens: 1, cache_creation_tokens: 0, cache_read_tokens: 0 },
});

beforeEach(() => {
  useThreads.setState({
    initialized: false,
    threads: [thread({ id: "t1" }), thread({ id: "t2" })],
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
    unreadThreads: new Set(),
    savedMessages: {},
    threadProgress: {},
    cancelling: false,
  });
  vi.clearAllMocks();
  // Each thread starts with its own message history in the "DB".
  const dbMessages: Record<string, Message[]> = { t1: [], t2: [] };
  vi.mocked(loadThreadMessages).mockImplementation(async (id) => {
    return dbMessages[id]?.map((m) => ({
      ...m,
      images: [],
      documents: [],
      toolCalls: [],
      subagents: [],
      duration_ms: m.duration_ms ?? null,
      bot_id: m.bot_id,
      variant_group: m.variant_group,
      variant_selected: m.variant_selected,
    } as MessageView)) ?? [];
  });
  vi.mocked(addMessage).mockImplementation(async (input) => {
    const m: Message = {
      id: `m_${input.role}_${(input.content ?? "").slice(0, 8)}`,
      thread_id: input.thread_id,
      role: input.role,
      content: input.content ?? "",
      kind: input.kind ?? "normal",
      duration_ms: input.duration_ms ?? null,
      bot_id: input.bot_id ?? null,
      variant_group: input.variant_group ?? null,
      variant_selected: 1,
      created_at: "2026-06-13 00:00:00",
      updated_at: "2026-06-13 00:00:00",
      provider: input.provider ?? "anthropic",
      model: input.model ?? "m",
    } as Message;
    if (!dbMessages[input.thread_id]) dbMessages[input.thread_id] = [];
    dbMessages[input.thread_id].push(m);
    return m;
  });
  vi.mocked(createThread).mockImplementation(async (input) => ({
    id: "t_new",
    title: input.title ?? "",
    provider: input.provider,
    model: input.model,
    workspace_id: input.workspaceId ?? null,
    favorite: 0,
    ephemeral: input.ephemeral ? 1 : 0,
    archived: 0,
    deep_research: 0,
    bot_id: input.botId ?? null,
    workspace_files_excluded: null,
    planner_active: 0,
    pre_planner_provider: null,
    pre_planner_model: null,
    created_at: "2026-06-13 00:00:00",
    updated_at: "2026-06-13 00:00:00",
  }));
});

describe("runningStreams lifecycle", () => {
  it("adds thread to runningStreams when send starts", async () => {
    let resolver: () => void;
    const p = new Promise<ChatResult>((r) => { resolver = () => r(reply("done")); });
    vi.mocked(chatStream).mockReturnValue(p);

    const sendPromise = useThreads.getState().send("hello", []);
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t1")).toBe(true));

    resolver!();
    await sendPromise;
    expect(useThreads.getState().runningStreams.has("t1")).toBe(false);
  });

  it("blocks send on the same thread while a stream is active", async () => {
    let resolver: () => void;
    const p = new Promise<ChatResult>((r) => { resolver = () => r(reply("done")); });
    vi.mocked(chatStream).mockReturnValue(p);

    const firstSend = useThreads.getState().send("first", []);
    // Wait for chatStream to actually be invoked, not just runningStreams.
    await vi.waitFor(() => expect(vi.mocked(chatStream)).toHaveBeenCalledTimes(1));

    // Second send on same thread should be a no-op.
    await useThreads.getState().send("second", []);
    expect(vi.mocked(chatStream)).toHaveBeenCalledTimes(1);

    resolver!();
    await firstSend;
  });

  it("allows send on a different thread while another is busy", async () => {
    let t1Resolver: () => void;
    let t2Resolver: () => void;
    const t1Promise = new Promise<ChatResult>((r) => { t1Resolver = () => r(reply("done")); });
    const t2Promise = new Promise<ChatResult>((r) => { t2Resolver = () => r(reply("done")); });
    let callCount = 0;
    vi.mocked(chatStream).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? t1Promise : t2Promise;
    });

    const firstSend = useThreads.getState().send("first", []);
    // Wait for chatStream to actually be invoked.
    await vi.waitFor(() => expect(vi.mocked(chatStream)).toHaveBeenCalledTimes(1));

    // Switch to t2 and send — should NOT be blocked.
    await useThreads.getState().selectThread("t2");
    const secondSend = useThreads.getState().send("second", []);
    // Wait for the second chatStream call.
    await vi.waitFor(() => expect(vi.mocked(chatStream)).toHaveBeenCalledTimes(2));

    // Both streams should have been started.
    expect(vi.mocked(chatStream)).toHaveBeenCalledTimes(2);

    t1Resolver!();
    t2Resolver!();
    await firstSend;
    await secondSend;
  });
});

describe("thread switching during stream", () => {
  it("does not corrupt the new thread's messages when switching mid-stream", async () => {
    // Seed t2 with some history.
    await useThreads.getState().selectThread("t2");
    // Start a stream on t2 that we'll let complete.
    let t2R: () => void;
    const t2P = new Promise<ChatResult>((r) => { t2R = () => r(reply("done")); });
    vi.mocked(chatStream).mockReturnValue(t2P);
    const t2Send = useThreads.getState().send("pre-existing", []);
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t2")).toBe(true));
    t2R!();
    await t2Send;
    const t2MessagesBefore = [...useThreads.getState().messages];
    expect(t2MessagesBefore.length).toBeGreaterThan(0);

    // Start a stream on t1 that will be paused.
    await useThreads.getState().selectThread("t1");
    let t1R: () => void;
    const t1P = new Promise<ChatResult>((r) => { t1R = () => r(reply("t1 reply")); });
    vi.mocked(chatStream).mockReturnValue(t1P);
    const t1Send = useThreads.getState().send("t1 message", []);
    // Wait for chatStream to be invoked (the call is stuck on t1P).
    await vi.waitFor(() => expect(vi.mocked(chatStream)).toHaveBeenCalledTimes(1));

    // Switch to t2 while t1 is still streaming (stuck on the promise).
    await useThreads.getState().selectThread("t2");

    // t2's messages should be its original messages, not t1's stream.
    const t2MessagesDuring = useThreads.getState().messages;
    expect(t2MessagesDuring.map((m) => m.content)).toEqual(
      t2MessagesBefore.map((m) => m.content),
    );

    // Clean up.
    t1R!();
    await t1Send;
  });

  it("marks thread as unread when stream completes while viewing a different thread", async () => {
    // Start a controlled stream on t1.
    let t1Resolver: () => void;
    const t1Promise = new Promise<ChatResult>((r) => { t1Resolver = () => r(reply("t1 reply")); });
    vi.mocked(chatStream).mockReturnValue(t1Promise);

    const t1Send = useThreads.getState().send("t1 message", []);
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t1")).toBe(true));

    // Switch to t2 while t1 is still streaming.
    await useThreads.getState().selectThread("t2");

    // Now complete t1's stream.
    t1Resolver!();
    await t1Send;

    // t1 should have the unread flag.
    expect(useThreads.getState().unreadThreads.has("t1")).toBe(true);
  });

  it("clears unread flag when selecting the thread", async () => {
    // Start and finish stream on t1 while viewing t2.
    let t1Resolver: () => void;
    const t1Promise = new Promise<ChatResult>((r) => { t1Resolver = () => r(reply("done")); });
    vi.mocked(chatStream).mockReturnValue(t1Promise);

    const t1Send = useThreads.getState().send("hello", []);
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t1")).toBe(true));

    await useThreads.getState().selectThread("t2");
    t1Resolver!();
    await t1Send;

    await vi.waitFor(() => expect(useThreads.getState().unreadThreads.has("t1")).toBe(true));

    // Switch back to t1 — unread should clear.
    await useThreads.getState().selectThread("t1");
    expect(useThreads.getState().unreadThreads.has("t1")).toBe(false);
  });
});

describe("savedMessages cache", () => {
  it("saves messages when switching away from a thread with an active stream", async () => {
    // Start stream on t1 and add a user message to "messages".
    useThreads.setState({ messages: [msg("t1", "user", "hello world")] });

    let resolver: () => void;
    const p = new Promise<ChatResult>((r) => { resolver = () => r(reply("ok")); });
    vi.mocked(chatStream).mockReturnValue(p);

    const t1Send = useThreads.getState().send("hi", []);
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t1")).toBe(true));

    // Switch to t2 — should save t1's messages.
    await useThreads.getState().selectThread("t2");
    const saved = useThreads.getState().savedMessages["t1"];
    expect(saved).toBeDefined();
    expect(saved.length).toBeGreaterThanOrEqual(1);

    resolver!();
    await t1Send;
  });

  it("restores saved messages when switching back to the streaming thread", async () => {
    // Pre-populate t1 with messages in the saved cache.
    const cachedMessages = [msg("t1", "user", "cached hello")];
    useThreads.setState({ savedMessages: { t1: cachedMessages } });

    await useThreads.getState().selectThread("t1");
    const restored = useThreads.getState().messages;
    expect(restored).toEqual(cachedMessages);
  });
});

describe("concurrent streams", () => {
  it("tracks both threads independently in runningStreams", async () => {
    let t1Resolver: () => void;
    let t2Resolver: () => void;
    const t1Promise = new Promise<void>((r) => { t1Resolver = r; });
    const t2Promise = new Promise<void>((r) => { t2Resolver = r; });

    let callCount = 0;
    vi.mocked(chatStream).mockImplementation(
      () => {
        callCount++;
        const p = callCount === 1 ? t1Promise : t2Promise;
        return p.then(() => reply("done"));
      },
    );

    // Start stream on t1.
    const t1Send = useThreads.getState().send("t1 hello", []);
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t1")).toBe(true));

    // Switch to t2 and start another stream.
    await useThreads.getState().selectThread("t2");
    const t2Send = useThreads.getState().send("t2 hello", []);
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t2")).toBe(true));

    // Both should be tracked.
    expect(useThreads.getState().runningStreams.size).toBe(2);
    expect(useThreads.getState().runningStreams.has("t1")).toBe(true);
    expect(useThreads.getState().runningStreams.has("t2")).toBe(true);

    // Resolve t1's stream.
    t1Resolver!();
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t1")).toBe(false));
    expect(useThreads.getState().runningStreams.has("t2")).toBe(true);

    // Resolve t2's stream.
    t2Resolver!();
    await vi.waitFor(() => expect(useThreads.getState().runningStreams.has("t2")).toBe(false));
    expect(useThreads.getState().runningStreams.size).toBe(0);

    // Await both sends to clean up.
    await t1Send;
    await t2Send;
  });

  it("does not leak a background thread's streamed text into the viewed thread", async () => {
    let deltaFor1!: (e: { text: string }) => void;
    let resolve1!: () => void;
    const pending1 = new Promise<void>((r) => { resolve1 = r; });
    vi.mocked(chatStream).mockImplementation((_p, _m, _msgs, onDelta) => {
      deltaFor1 = onDelta as unknown as (e: { text: string }) => void;
      return pending1.then(() => reply("t1 done"));
    });

    // Start a stream on t1 (the thread currently on screen).
    const t1Send = useThreads.getState().send("t1 hello", []);
    await vi.waitFor(() => expect(vi.mocked(chatStream)).toHaveBeenCalledTimes(1));

    // A delta while t1 is viewed paints the streaming bubble.
    deltaFor1({ text: "visible in t1" });
    expect(useThreads.getState().streamingContent).toBe("visible in t1");

    // User navigates to t2 — the bubble clears with the thread switch.
    await useThreads.getState().selectThread("t2");
    expect(useThreads.getState().currentThreadId).toBe("t2");
    expect(useThreads.getState().streamingContent).toBeNull();

    // t1 keeps streaming in the background. The sleep clears the 100ms flush
    // throttle so a flush *would* fire if unguarded — but it must not repaint
    // t2's view with t1's text.
    await new Promise((r) => setTimeout(r, 110));
    deltaFor1({ text: " — more from t1" });
    expect(useThreads.getState().streamingContent).toBeNull();

    resolve1();
    await t1Send;
  });
});

describe("per-thread run progress", () => {
  const mk = (current: number) => ({
    startedAt: 0,
    stepStartedAt: 0,
    status: "running" as const,
    current,
    steps: [
      { label: "a", status: "active" as const },
      { label: "b", status: "pending" as const },
    ],
  });

  it("stores progress keyed by thread id", () => {
    useThreads.setState({
      threadProgress: { t1: mk(0), t2: mk(1) },
    });

    const state = useThreads.getState();
    expect(state.threadProgress["t1"]?.current).toBe(0);
    expect(state.threadProgress["t2"]?.current).toBe(1);
  });

  it("clears only the specific thread's progress on completion", () => {
    useThreads.setState({
      threadProgress: { t1: mk(1), t2: mk(0) },
    });

    // Simulate clearing t1's progress (as done in finally blocks).
    useThreads.setState((s) => {
      const updated = { ...s.threadProgress };
      delete updated["t1"];
      return { threadProgress: updated };
    });

    const state = useThreads.getState();
    expect(state.threadProgress["t1"]).toBeUndefined();
    expect(state.threadProgress["t2"]?.current).toBe(0);
  });
});
