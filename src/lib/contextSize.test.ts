import { describe, expect, it } from "vitest";
import {
  CHARS_PER_TOKEN,
  estimateContextTokens,
  estimateMessagesTokens,
  estimateTokens,
  IMAGE_TOKENS_EST,
} from "@/lib/contextSize";
import type { CompactableMessage } from "@/lib/compaction";

const userMsg = (content: string, extra: Partial<CompactableMessage> = {}): CompactableMessage => ({
  role: "user",
  content,
  kind: "normal",
  ...extra,
});

describe("estimateTokens", () => {
  it("uses ~4 chars per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("a".repeat(CHARS_PER_TOKEN * 3))).toBe(3);
    expect(estimateTokens("a".repeat(CHARS_PER_TOKEN * 3 + 1))).toBe(4);
  });
});

describe("estimateMessagesTokens", () => {
  it("sums message content and counts images", () => {
    const msgs: CompactableMessage[] = [
      userMsg("a".repeat(40)), // 10 tokens
      userMsg("b".repeat(40), { images: [{ media_type: "image/png", data: "x" }] }),
    ];
    expect(estimateMessagesTokens(msgs)).toBe(10 + 10 + IMAGE_TOKENS_EST);
  });

  it("counts only the post-compaction history (summary + after)", () => {
    const msgs: CompactableMessage[] = [
      userMsg("z".repeat(400)), // dropped: before the summary
      { role: "assistant", content: "short summary", kind: "summary" },
      userMsg("y".repeat(40)),
    ];
    // The big pre-summary message is excluded; the summary is reframed + the
    // trailing user message counts. Far smaller than including everything.
    const got = estimateMessagesTokens(msgs);
    expect(got).toBeLessThan(estimateTokens("z".repeat(400)));
    expect(got).toBeGreaterThan(estimateTokens("y".repeat(40)));
  });
});

describe("estimateContextTokens", () => {
  it("adds the unsent draft (text, images, documents)", () => {
    const base = estimateContextTokens({
      messages: [userMsg("a".repeat(40))],
      draftText: "",
      draftImageCount: 0,
      draftDocuments: [],
    });
    const withDraft = estimateContextTokens({
      messages: [userMsg("a".repeat(40))],
      draftText: "hello there",
      draftImageCount: 2,
      draftDocuments: [{ name: "n.txt", text: "doc body" }],
    });
    expect(base).toBe(10);
    expect(withDraft).toBeGreaterThan(base + 2 * IMAGE_TOKENS_EST);
  });
});
