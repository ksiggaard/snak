import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks mirror threads.streams.test.ts so send() runs end-to-end against an
// in-memory "DB" and a stubbed chatStream. These tests guard the planner
// orchestration: the final-wave race is gone (no cancelStream on normal
// completion) and a failing worker no longer aborts the whole plan.

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
  // Keep the real helpers the planner path uses (isModelOutput, applyToolEvent,
  // persistTransparency, …); only loadThreadMessages is stubbed.
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
import { useModels } from "@/store/models";
import { useKeys } from "@/store/keys";
import { addMessage, getSetting } from "@/lib/db";
import { chatStream, cancelStream } from "@/lib/chat";
import { loadThreadMessages, type MessageView } from "@/lib/messages";
import { PROVIDERS } from "@/lib/providers";
import type { ApiMessage } from "@/lib/chat";
import type { Message, Thread } from "@/types/db";

const thread = (over: Partial<Thread>): Thread => ({
  id: "t1",
  title: "A thread",
  provider: "anthropic",
  model: "m1",
  workspace_id: null,
  favorite: 0,
  ephemeral: 0,
  archived: 0,
  deep_research: 0,
  output_type: "default",
  bot_id: null,
  workspace_files_excluded: null,
  planner_active: 1,
  pre_planner_provider: null,
  pre_planner_model: null,
  created_at: "2026-06-13 00:00:00",
  updated_at: "2026-06-13 00:00:00",
  ...over,
});

const reply = (content: string) => ({
  content,
  model: "m1",
  usage: { input_tokens: 1, output_tokens: 1, cache_creation_tokens: 0, cache_read_tokens: 0 },
});

const PLAN = {
  strategy: "multi_step",
  reasoning: "decompose",
  steps: [
    { id: "w1", description: "Worker 1", provider: "anthropic", model: "m1", prompt: "do w1", depends_on: [] },
    { id: "w2", description: "Worker 2", provider: "anthropic", model: "m1", prompt: "do w2", depends_on: [] },
    { id: "synth", description: "Synthesis", provider: "anthropic", model: "m1", prompt: "Combine {w1} and {w2}", depends_on: ["w1", "w2"] },
  ],
};
const PLAN_REPLY = `I'll decompose this.\n\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``;

/** Is this chatStream call the planner's planning request? */
function isPlannerCall(messages: ApiMessage[]): boolean {
  return messages.some(
    (m) => m.role === "system" && m.content.includes("planning assistant"),
  );
}

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
    draftProvider: "anthropic",
    draftModel: "m1",
    plannerProvider: "anthropic",
    plannerModel: "m1",
    criticProvider: null,
    criticModel: null,
    runningStreams: new Set(),
    unreadThreads: new Set(),
    savedMessages: {},
    threadProgress: {},
    cancelling: false,
  });
  useModels.setState({
    models: [{ id: 1, provider: "anthropic", model_id: "m1", label: "M1", sort_order: 1, notes: "" }],
  });
  useKeys.setState({ present: new Set(["anthropic"]) });

  vi.clearAllMocks();
  // Disable the critic loop so the chatStream sequence is just planner + steps.
  vi.mocked(getSetting).mockImplementation(async (k: string) =>
    k === "planner_critic_rounds" ? "0" : null,
  );

  const dbMessages: Record<string, Message[]> = { t1: [] };
  vi.mocked(loadThreadMessages).mockImplementation(
    async (id) =>
      dbMessages[id]?.map(
        (m) =>
          ({ ...m, images: [], documents: [], toolCalls: [], subagents: [] }) as MessageView,
      ) ?? [],
  );
  vi.mocked(addMessage).mockImplementation(async (input) => {
    const m = {
      id: `m_${input.role}_${(input.content ?? "").slice(0, 8)}`,
      thread_id: input.thread_id,
      role: input.role,
      content: input.content ?? "",
      kind: "normal",
      duration_ms: null,
      bot_id: null,
      variant_group: null,
      variant_selected: 1,
      created_at: "2026-06-13 00:00:00",
      updated_at: "2026-06-13 00:00:00",
      provider: "anthropic",
      model: "m1",
      output_type: input.output_type ?? null,
    } as Message;
    (dbMessages[input.thread_id] ??= []).push(m);
    return m;
  });
});

/** Contents of every persisted assistant/user message. */
function persistedContents(): string[] {
  return vi.mocked(addMessage).mock.calls.map((c) => c[0].content ?? "");
}

describe("planner orchestration", () => {
  it("completes a multi_step plan without calling cancelStream and persists only the synthesis", async () => {
    vi.mocked(chatStream).mockImplementation(async (_p, _m, messages) => {
      if (isPlannerCall(messages)) return reply(PLAN_REPLY);
      const user = messages[messages.length - 1]?.content ?? "";
      if (user.startsWith("do w1")) return reply("W1-OUT");
      if (user.startsWith("do w2")) return reply("W2-OUT");
      return reply("SYNTH-ANSWER");
    });

    await useThreads.getState().send("research X", []);

    // The headline regression: normal completion never fires the global cancel.
    expect(cancelStream).not.toHaveBeenCalled();
    const contents = persistedContents();
    // The synthesis is persisted as the final answer...
    expect(contents).toContain("SYNTH-ANSWER");
    // ...but the worker outputs are not persisted as chat messages.
    expect(contents).not.toContain("W1-OUT");
    expect(contents).not.toContain("W2-OUT");
  });

  it("isolates a failing worker: the plan still finishes and a failure note is posted", async () => {
    vi.mocked(chatStream).mockImplementation(async (_p, _m, messages) => {
      if (isPlannerCall(messages)) return reply(PLAN_REPLY);
      const user = messages[messages.length - 1]?.content ?? "";
      if (user.startsWith("do w1")) throw new Error("provider 500");
      if (user.startsWith("do w2")) return reply("W2-OUT");
      return reply("SYNTH-ANSWER");
    });

    await useThreads.getState().send("research X", []);

    expect(cancelStream).not.toHaveBeenCalled();
    const contents = persistedContents();
    // Synthesis still runs despite the failed worker.
    expect(contents).toContain("SYNTH-ANSWER");
    // A note naming the failed step is posted into the thread.
    expect(contents.some((c) => c.includes("w1") && /fail/i.test(c))).toBe(true);
  });
});
