import { describe, it, expect } from "vitest";
import {
  buildCompactionRequest,
  canCompact,
  COMPACT_INSTRUCTION,
  COMPACT_SYSTEM_PROMPT,
  compactHistory,
  latestSummaryIndex,
  summaryContext,
  type CompactableMessage,
} from "@/lib/compaction";

const user = (
  content: string,
  images: { media_type: string; data: string }[] = [],
): CompactableMessage => ({ role: "user", content, kind: "normal", images });

const assistant = (content: string): CompactableMessage => ({
  role: "assistant",
  content,
  kind: "normal",
});

const summary = (content: string): CompactableMessage => ({
  role: "assistant",
  content,
  kind: "summary",
});

describe("latestSummaryIndex", () => {
  it("returns -1 when there is no summary row", () => {
    expect(latestSummaryIndex([])).toBe(-1);
    expect(latestSummaryIndex([user("hi"), assistant("hello")])).toBe(-1);
  });

  it("returns the index of the only summary", () => {
    expect(latestSummaryIndex([user("a"), summary("s"), user("b")])).toBe(1);
  });

  it("returns the latest of multiple summaries", () => {
    const msgs = [
      user("a"),
      summary("s1"),
      user("b"),
      summary("s2"),
      user("c"),
    ];
    expect(latestSummaryIndex(msgs)).toBe(3);
  });
});

describe("canCompact", () => {
  it("is false for an empty or single-message thread", () => {
    expect(canCompact([])).toBe(false);
    expect(canCompact([user("hi")])).toBe(false);
  });

  it("is true once one exchange exists", () => {
    expect(canCompact([user("hi"), assistant("hello")])).toBe(true);
  });

  it("counts only messages after the latest summary", () => {
    expect(canCompact([user("a"), assistant("b"), summary("s")])).toBe(false);
    expect(
      canCompact([user("a"), assistant("b"), summary("s"), user("c")]),
    ).toBe(false);
    expect(
      canCompact([
        user("a"),
        assistant("b"),
        summary("s"),
        user("c"),
        assistant("d"),
      ]),
    ).toBe(true);
  });
});

describe("compactHistory", () => {
  it("maps a never-compacted thread through unchanged", () => {
    const img = { media_type: "image/jpeg", data: "AAAA" };
    const history = compactHistory([user("hi", [img]), assistant("hello")]);
    expect(history).toEqual([
      { role: "user", content: "hi", images: [img] },
      { role: "assistant", content: "hello", images: [] },
    ]);
  });

  it("replaces everything up to the summary with a leading user turn", () => {
    const history = compactHistory([
      user("old question"),
      assistant("old answer"),
      summary("the gist"),
      user("new question"),
    ]);
    expect(history).toEqual([
      { role: "user", content: summaryContext("the gist"), images: [] },
      { role: "user", content: "new question", images: [] },
    ]);
  });

  it("uses only the latest summary when compacted twice", () => {
    const history = compactHistory([
      user("a"),
      summary("first"),
      user("b"),
      summary("second"),
      user("c"),
    ]);
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe(summaryContext("second"));
    expect(history[1].content).toBe("c");
  });

  it("yields just the summary turn when the summary is the last row", () => {
    const history = compactHistory([user("a"), assistant("b"), summary("s")]);
    expect(history).toEqual([
      { role: "user", content: summaryContext("s"), images: [] },
    ]);
  });
});

describe("buildCompactionRequest", () => {
  it("frames the compacted history with system prompt and instruction", () => {
    const req = buildCompactionRequest([user("hi"), assistant("hello")]);
    expect(req[0]).toEqual({
      role: "system",
      content: COMPACT_SYSTEM_PROMPT,
      images: [],
    });
    expect(req[req.length - 1]).toEqual({
      role: "user",
      content: COMPACT_INSTRUCTION,
      images: [],
    });
    expect(req.slice(1, -1).map((m) => m.content)).toEqual(["hi", "hello"]);
  });

  it("strips images from the summarized history", () => {
    const img = { media_type: "image/png", data: "QkM=" };
    const req = buildCompactionRequest([user("look", [img]), assistant("ok")]);
    expect(req.every((m) => m.images?.length === 0)).toBe(true);
  });

  it("composes: a previous summary is folded into the next request", () => {
    const req = buildCompactionRequest([
      user("a"),
      assistant("b"),
      summary("gist"),
      user("c"),
      assistant("d"),
    ]);
    const contents = req.map((m) => m.content);
    expect(contents).toEqual([
      COMPACT_SYSTEM_PROMPT,
      summaryContext("gist"),
      "c",
      "d",
      COMPACT_INSTRUCTION,
    ]);
    expect(contents).not.toContain("a");
  });
});
