import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer so store actions don't hit tauri-plugin-sql. Only the
// functions the tested paths call need real behavior.
vi.mock("@/lib/db", () => ({
  listThreads: vi.fn(async () => []),
  purgeEphemeralThreads: vi.fn(async () => {}),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  SYSTEM_PROMPT_ADDENDUM_KEY: "system_prompt_addendum",
}));

vi.mock("@/lib/messages", () => ({
  loadThreadMessages: vi.fn(async () => []),
}));

import { shouldRememberThread, useThreads } from "@/store/threads";
import {
  getSetting,
  listThreads,
  purgeEphemeralThreads,
  setSetting,
} from "@/lib/db";
import { PROVIDERS } from "@/lib/providers";
import type { Thread } from "@/types/db";

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
    draftProvider: PROVIDERS[0].id,
    draftModel: PROVIDERS[0].defaultModel,
  });
  vi.clearAllMocks();
});

describe("shouldRememberThread (T29)", () => {
  it("remembers a normal thread", () => {
    expect(shouldRememberThread(thread({ ephemeral: 0 }))).toBe(true);
  });

  it("never remembers an ephemeral thread", () => {
    expect(shouldRememberThread(thread({ ephemeral: 1 }))).toBe(false);
  });

  it("remembers an unknown thread (pre-T29 behavior preserved)", () => {
    expect(shouldRememberThread(undefined)).toBe(true);
  });
});

describe("incognito drafts in the threads store", () => {
  it("startNewChat({ incognito: true }) flags the draft", () => {
    useThreads.getState().startNewChat({ incognito: true });
    expect(useThreads.getState().draftIncognito).toBe(true);
  });

  it("startNewChat() resets the incognito flag", () => {
    useThreads.setState({ draftIncognito: true });
    useThreads.getState().startNewChat();
    expect(useThreads.getState().draftIncognito).toBe(false);
  });

  it("startNewChatInProject() resets the incognito flag", () => {
    useThreads.setState({ draftIncognito: true });
    useThreads.getState().startNewChatInProject("p1");
    expect(useThreads.getState().draftIncognito).toBe(false);
  });

  it("selectThread() persists last_thread_id for a normal thread", async () => {
    useThreads.setState({ threads: [thread({ id: "t1", ephemeral: 0 })] });
    await useThreads.getState().selectThread("t1");
    expect(setSetting).toHaveBeenCalledWith("last_thread_id", "t1");
  });

  it("selectThread() never persists last_thread_id for an incognito thread", async () => {
    useThreads.setState({ threads: [thread({ id: "t1", ephemeral: 1 })] });
    await useThreads.getState().selectThread("t1");
    expect(setSetting).not.toHaveBeenCalled();
    // The thread itself is still selected — incognito behaves normally in-app.
    expect(useThreads.getState().currentThreadId).toBe("t1");
  });

  it("init() purges ephemeral threads before loading the thread list", async () => {
    const order: string[] = [];
    vi.mocked(purgeEphemeralThreads).mockImplementation(async () => {
      order.push("purge");
    });
    vi.mocked(listThreads).mockImplementation(async () => {
      order.push("list");
      return [];
    });
    vi.mocked(getSetting).mockImplementation(async () => {
      order.push("getSetting");
      return null;
    });
    await useThreads.getState().init();
    expect(order[0]).toBe("purge");
    expect(order.indexOf("purge")).toBeLessThan(order.indexOf("list"));
  });
});
