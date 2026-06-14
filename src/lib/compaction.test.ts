import { describe, it, expect } from "vitest";
import {
  buildCompactionRequest,
  canCompact,
  COMPACT_INSTRUCTION,
  COMPACT_SYSTEM_PROMPT,
  compactHistory,
  groupLabelingActive,
  latestSummaryIndex,
  summaryContext,
  type CompactableMessage,
  type GroupContext,
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

/** Assistant turn authored by a specific persona (T43). */
const assistantBy = (content: string, botId: string): CompactableMessage => ({
  role: "assistant",
  content,
  kind: "normal",
  bot_id: botId,
});

const summary = (content: string): CompactableMessage => ({
  role: "assistant",
  content,
  kind: "summary",
});

/** Expected image-manifest suffix appended to a message's content. Pass the
 * labels (and optional descriptions) in image order. */
const manifest = (...labels: string[]) =>
  `\n\n[Images in this message, referenceable by label throughout the ` +
  `conversation: ${labels.map((l) => `Image ${l}`).join("; ")}.]`;

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
  it("maps a never-compacted thread through unchanged (plus the image manifest)", () => {
    const img = { media_type: "image/jpeg", data: "AAAA" };
    const history = compactHistory([user("hi", [img]), assistant("hello")]);
    expect(history).toEqual([
      { role: "user", content: "hi" + manifest("A"), images: [img] },
      { role: "assistant", content: "hello", images: [] },
    ]);
  });

  it("forwards fetched images from a recent assistant turn (within the window)", () => {
    const img = { media_type: "image/jpeg", data: "BBBB" };
    const assistantWithImage: CompactableMessage = {
      role: "assistant",
      content: "here you go",
      kind: "normal",
      images: [img],
    };
    const history = compactHistory([
      user("show me an elephant"),
      assistantWithImage,
    ]);
    expect(history).toEqual([
      { role: "user", content: "show me an elephant", images: [] },
      // The most recent assistant turn's fetched images ride as vision input,
      // so a follow-up can reference them — and the manifest binds the label.
      { role: "assistant", content: "here you go" + manifest("A"), images: [img] },
    ]);
  });

  it("strips fetched images from assistant turns older than the recent window", () => {
    const img = { media_type: "image/jpeg", data: "BBBB" };
    const oldWithImage: CompactableMessage = {
      role: "assistant",
      content: "old pics",
      kind: "normal",
      images: [img],
    };
    // `old pics` is the 4th-most-recent assistant turn (window is the last 3),
    // so its images are dropped while the newer assistant turns are kept.
    const history = compactHistory([
      user("q0"),
      oldWithImage,
      user("q1"),
      assistant("a1"),
      user("q2"),
      assistant("a2"),
      user("q3"),
      assistant("a3"),
    ]);
    const oldEntry = history.find((h) => h.content.startsWith("old pics"));
    expect(oldEntry?.images).toEqual([]);
    // The label manifest still rides, so the old image stays referenceable by
    // name even though its pixels are no longer sent.
    expect(oldEntry?.content).toBe("old pics" + manifest("A"));
  });

  it("accumulates labels across messages and uses title/source as the description", () => {
    const a: CompactableMessage = {
      role: "assistant",
      content: "first batch",
      kind: "normal",
      images: [
        { media_type: "image/png", data: "1", title: "Victorian" },
        { media_type: "image/png", data: "2", source: "https://ex.com/x" },
      ],
    };
    const b: CompactableMessage = {
      role: "assistant",
      content: "second batch",
      kind: "normal",
      images: [{ media_type: "image/png", data: "3" }],
    };
    const history = compactHistory([user("houses"), a, user("more"), b]);
    expect(history[1].content).toBe(
      "first batch\n\n[Images in this message, referenceable by label " +
        "throughout the conversation: Image A — Victorian; Image B — " +
        "https://ex.com/x.]",
    );
    // The counter continues across messages — the next image is C, not A.
    expect(history[3].content).toBe("second batch" + manifest("C"));
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

  it("appends attached-document text to the user turn as a labelled block (T39)", () => {
    const withDoc: CompactableMessage = {
      role: "user",
      content: "see attached",
      kind: "normal",
      documents: [{ name: "notes.txt", text: "hello world" }],
    };
    const history = compactHistory([withDoc, assistant("ok")]);
    expect(history[0].content).toBe(
      "see attached\n\n--- Attached document: notes.txt ---\n```\nhello world\n```",
    );
    expect(history[1].content).toBe("ok");
  });

  it("keeps document-less turns byte-identical to before", () => {
    const history = compactHistory([user("hi  "), assistant("hello")]);
    expect(history).toEqual([
      { role: "user", content: "hi  ", images: [] },
      { role: "assistant", content: "hello", images: [] },
    ]);
  });
});

describe("groupLabelingActive", () => {
  const group: GroupContext = { selfBotId: "A", roster: {} };

  it("is false without a group context", () => {
    expect(groupLabelingActive([assistantBy("a", "A"), assistantBy("b", "B")]))
      .toBe(false);
  });

  it("is false with a single distinct author (plain or one-persona thread)", () => {
    expect(groupLabelingActive([user("hi"), assistant("a")], group)).toBe(false);
    expect(
      groupLabelingActive([user("hi"), assistantBy("a", "A")], group),
    ).toBe(false);
  });

  it("is true with two distinct authors (base + persona, or two personas)", () => {
    expect(
      groupLabelingActive([assistant("base"), assistantBy("a", "A")], group),
    ).toBe(true);
    expect(
      groupLabelingActive([assistantBy("a", "A"), assistantBy("b", "B")], group),
    ).toBe(true);
  });

  it("counts only the live window after the latest summary", () => {
    const msgs = [
      assistantBy("old", "A"),
      assistant("oldbase"),
      summary("gist"),
      assistantBy("new", "A"),
    ];
    // Only the post-summary window (one author, A) counts → inactive.
    expect(groupLabelingActive(msgs, group)).toBe(false);
  });
});

describe("compactHistory group labeling", () => {
  const roster = { A: "Alice", B: "Bob" };

  it("is byte-identical to the no-group output when no group is passed", () => {
    const msgs = [
      user("q"),
      assistant("base"),
      assistantBy("a", "A"),
      assistantBy("b", "B"),
    ];
    expect(compactHistory(msgs)).toEqual([
      { role: "user", content: "q", images: [] },
      { role: "assistant", content: "base", images: [] },
      { role: "assistant", content: "a", images: [] },
      { role: "assistant", content: "b", images: [] },
    ]);
  });

  it("adds no prefixes when only one author is present", () => {
    const group: GroupContext = { selfBotId: "A", roster };
    const history = compactHistory(
      [user("q"), assistantBy("only me", "A")],
      group,
    );
    expect(history.map((m) => m.content)).toEqual(["q", "only me"]);
  });

  it("labels base turns for a persona reader, leaving its own unprefixed", () => {
    const group: GroupContext = { selfBotId: "A", roster, baseLabel: "Assistant" };
    const history = compactHistory(
      [user("q"), assistant("base says"), assistantBy("alice says", "A")],
      group,
    );
    expect(history).toEqual([
      { role: "user", content: "q", images: [] },
      { role: "assistant", content: "[Assistant]: base says", images: [] },
      { role: "assistant", content: "alice says", images: [] },
    ]);
  });

  it("labels the base and other personas from persona A's perspective", () => {
    const group: GroupContext = { selfBotId: "A", roster, baseLabel: "Assistant" };
    const history = compactHistory(
      [
        assistant("base"),
        assistantBy("from alice", "A"),
        assistantBy("from bob", "B"),
      ],
      group,
    );
    expect(history.map((m) => m.content)).toEqual([
      "[Assistant]: base",
      "from alice",
      "[Bob]: from bob",
    ]);
  });

  it("labels every persona for the base-assistant reader, leaving base turns plain", () => {
    const group: GroupContext = { selfBotId: null, roster };
    const history = compactHistory(
      [
        assistant("base"),
        assistantBy("from alice", "A"),
        assistantBy("from bob", "B"),
      ],
      group,
    );
    expect(history.map((m) => m.content)).toEqual([
      "base",
      "[Alice]: from alice",
      "[Bob]: from bob",
    ]);
  });

  it("falls back to the base label for an orphaned (deleted) bot_id", () => {
    const group: GroupContext = { selfBotId: "A", roster, baseLabel: "Assistant" };
    const history = compactHistory(
      [assistantBy("mine", "A"), assistantBy("ghost", "GONE")],
      group,
    );
    expect(history.map((m) => m.content)).toEqual([
      "mine",
      "[Assistant]: ghost",
    ]);
  });

  it("never prefixes user turns or the injected summary turn", () => {
    const group: GroupContext = { selfBotId: "A", roster, baseLabel: "Assistant" };
    const history = compactHistory(
      [
        assistantBy("old", "A"),
        summary("gist"),
        user("follow-up"),
        assistantBy("mine", "A"),
        assistantBy("bobs", "B"),
      ],
      group,
    );
    expect(history.map((m) => m.content)).toEqual([
      summaryContext("gist"),
      "follow-up",
      "mine",
      "[Bob]: bobs",
    ]);
  });

  it("prepends the label ahead of folded document text", () => {
    const group: GroupContext = { selfBotId: "A", roster, baseLabel: "Assistant" };
    const bobWithDoc: CompactableMessage = {
      role: "assistant",
      content: "see attached",
      kind: "normal",
      bot_id: "B",
      documents: [{ name: "notes.txt", text: "hello" }],
    };
    const history = compactHistory([assistantBy("mine", "A"), bobWithDoc], group);
    expect(history[1].content).toBe(
      "[Bob]: see attached\n\n--- Attached document: notes.txt ---\n```\nhello\n```",
    );
  });

  it("forwards a recent assistant turn's images even when labeling is active", () => {
    const group: GroupContext = { selfBotId: "A", roster };
    const img = { media_type: "image/png", data: "QkM=" };
    const bobWithImage: CompactableMessage = {
      role: "assistant",
      content: "look",
      kind: "normal",
      bot_id: "B",
      images: [img],
    };
    const history = compactHistory([assistantBy("mine", "A"), bobWithImage], group);
    // Speaker label is still applied; the recent fetched image rides along so
    // the reader can react to what was just shown, plus the label manifest.
    expect(history[1]).toEqual({
      role: "assistant",
      content: "[Bob]: look" + manifest("A"),
      images: [img],
    });
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
