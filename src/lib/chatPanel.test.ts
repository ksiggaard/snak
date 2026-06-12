import { describe, it, expect } from "vitest";
import {
  mediaEntries,
  searchChatMessages,
  userMessageEntries,
} from "@/lib/chatPanel";
import type { MessageView } from "@/lib/messages";

function msg(over: Partial<MessageView>): MessageView {
  return {
    id: "m1",
    thread_id: "t1",
    role: "user",
    content: "",
    kind: "normal",
    duration_ms: null,
    created_at: "2026-06-12 10:00:00",
    images: [],
    toolCalls: [],
    ...over,
  } as MessageView;
}

const THREAD: MessageView[] = [
  msg({ id: "u1", role: "user", content: "How do I deploy the app?" }),
  msg({
    id: "a1",
    role: "assistant",
    content: "Use the deploy script. It handles everything.",
  }),
  msg({
    id: "u2",
    role: "user",
    content: "Thanks!\nSecond line is ignored in the label",
    images: [{ media_type: "image/jpeg", data: "abc" }],
  }),
  msg({
    id: "s1",
    role: "assistant",
    kind: "summary",
    content: "Summary of the deploy discussion",
  }),
];

describe("searchChatMessages", () => {
  it("returns nothing for an empty/whitespace query", () => {
    expect(searchChatMessages(THREAD, "")).toEqual([]);
    expect(searchChatMessages(THREAD, "   ")).toEqual([]);
  });

  it("matches case-insensitively, all terms required", () => {
    const hits = searchChatMessages(THREAD, "DEPLOY");
    expect(hits.map((h) => h.id)).toEqual(["u1", "a1", "s1"]);
    expect(
      searchChatMessages(THREAD, "deploy script").map((h) => h.id),
    ).toEqual(["a1"]);
    expect(searchChatMessages(THREAD, "deploy zebra")).toEqual([]);
  });

  it("carries a snippet containing the match", () => {
    const [hit] = searchChatMessages(THREAD, "script");
    expect(hit.snippet.toLowerCase()).toContain("script");
  });
});

describe("userMessageEntries", () => {
  it("lists only user messages, labeled by first line, truncated", () => {
    const entries = userMessageEntries(THREAD);
    expect(entries.map((e) => e.id)).toEqual(["u1", "u2"]);
    expect(entries[1].label).toBe("Thanks!");

    const long = msg({ id: "u3", content: "x".repeat(120) });
    const [e] = userMessageEntries([long]);
    expect(e.label.length).toBe(81); // 80 chars + ellipsis
    expect(e.label.endsWith("…")).toBe(true);
  });
});

describe("mediaEntries", () => {
  it("flattens images in message order with their source message id", () => {
    const entries = mediaEntries(THREAD);
    expect(entries).toHaveLength(1);
    expect(entries[0].messageId).toBe("u2");
    expect(entries[0].image.data).toBe("abc");
  });
});
