import { describe, expect, it } from "vitest";
import {
  buildMemoryUpdateMessages,
  MAX_AUTO_ADDS_PER_TURN,
  MAX_MEMORY_CHARS,
  MAX_MOOD_CHARS,
  parseMemoryOps,
} from "@/lib/personaMemory";
import type { BotMemory } from "@/types/db";

const memory = (id: string, content: string): BotMemory => ({
  id,
  bot_id: "b1",
  content,
  source: "user",
  created_at: "2026-06-12 00:00:00",
  updated_at: "2026-06-12 00:00:00",
});

const bot = (
  over: Partial<Parameters<typeof buildMemoryUpdateMessages>[0]>,
) => ({
  name: "John",
  mood_enabled: 1,
  mood: "",
  ...over,
});

describe("buildMemoryUpdateMessages", () => {
  it("returns a system message followed by one user message", () => {
    const msgs = buildMemoryUpdateMessages(bot({}), [], "hi", "hello");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
  });

  it("names the persona and lists current memories with their ids", () => {
    const msgs = buildMemoryUpdateMessages(
      bot({}),
      [memory("m1", "Has two kids"), memory("m2", "Prefers TypeScript")],
      "hi",
      "hello",
    );
    const system = msgs[0].content;
    expect(system).toContain("memory manager for John");
    expect(system).toContain("- m1: Has two kids");
    expect(system).toContain("- m2: Prefers TypeScript");
  });

  it("shows '(none)' memories and a '(neutral)' mood when blank", () => {
    const system = buildMemoryUpdateMessages(bot({}), [], "a", "b")[0].content;
    expect(system).toContain("(none)");
    expect(system).toContain("Current mood: (neutral)");
  });

  it("shows the current mood when set", () => {
    const system = buildMemoryUpdateMessages(
      bot({ mood: "cheerful" }),
      [],
      "a",
      "b",
    )[0].content;
    expect(system).toContain("Current mood: cheerful");
  });

  it("asks the mood question only when mood is enabled", () => {
    const on = buildMemoryUpdateMessages(bot({}), [], "a", "b")[0].content;
    expect(on).toContain("How does John feel after this exchange?");

    const off = buildMemoryUpdateMessages(
      bot({ mood_enabled: 0 }),
      [],
      "a",
      "b",
    )[0].content;
    expect(off).not.toContain("How does John feel");
    expect(off).toContain('"mood" must always be null');
  });

  it("carries the exchange in the user message", () => {
    const user = buildMemoryUpdateMessages(
      bot({}),
      [],
      "I have two kids",
      "Nice!",
    )[1].content;
    expect(user).toContain("User said:\nI have two kids");
    expect(user).toContain("John replied:\nNice!");
  });

  it("truncates each exchange side to ~4000 chars", () => {
    const long = "x".repeat(10_000);
    const user = buildMemoryUpdateMessages(bot({}), [], long, long)[1].content;
    expect(user.length).toBeLessThan(8200);
  });
});

describe("parseMemoryOps", () => {
  it("parses a plain JSON object", () => {
    expect(
      parseMemoryOps(
        '{"add": ["Has two kids"], "update": [{"id": "m1", "content": "new"}], "delete": ["m2"], "mood": "cheerful"}',
      ),
    ).toEqual({
      add: ["Has two kids"],
      update: [{ id: "m1", content: "new" }],
      delete: ["m2"],
      mood: "cheerful",
    });
  });

  it("strips a wrapping code fence", () => {
    const ops = parseMemoryOps(
      '```json\n{"add": [], "update": [], "delete": [], "mood": null}\n```',
    );
    expect(ops).toEqual({ add: [], update: [], delete: [], mood: null });
  });

  it("tolerates prose around the JSON object", () => {
    const ops = parseMemoryOps(
      'Here are the ops:\n{"add": ["A fact"], "update": [], "delete": [], "mood": null}\nDone.',
    );
    expect(ops?.add).toEqual(["A fact"]);
  });

  it("returns null for garbage, non-JSON, and non-object JSON", () => {
    expect(parseMemoryOps("")).toBe(null);
    expect(parseMemoryOps("no json here")).toBe(null);
    expect(parseMemoryOps("{not valid json}")).toBe(null);
    expect(parseMemoryOps("[1, 2, 3]")).toBe(null);
    expect(parseMemoryOps("42")).toBe(null);
  });

  it("treats missing fields as no-ops", () => {
    expect(parseMemoryOps("{}")).toEqual({
      add: [],
      update: [],
      delete: [],
      mood: null,
    });
  });

  it("clamps adds to the per-turn cap", () => {
    const ops = parseMemoryOps(
      JSON.stringify({ add: ["a", "b", "c", "d", "e"] }),
    );
    expect(ops?.add).toHaveLength(MAX_AUTO_ADDS_PER_TURN);
    expect(ops?.add).toEqual(["a", "b", "c"]);
  });

  it("slices over-long entries and moods to their max lengths", () => {
    const ops = parseMemoryOps(
      JSON.stringify({
        add: ["x".repeat(1000)],
        update: [{ id: "m1", content: "y".repeat(1000) }],
        mood: "z".repeat(1000),
      }),
    );
    expect(ops?.add[0]).toHaveLength(MAX_MEMORY_CHARS);
    expect(ops?.update[0].content).toHaveLength(MAX_MEMORY_CHARS);
    expect(ops?.mood).toHaveLength(MAX_MOOD_CHARS);
  });

  it("drops non-string and malformed entries", () => {
    const ops = parseMemoryOps(
      JSON.stringify({
        add: ["ok", 42, null, {}],
        update: [
          { id: "m1", content: "ok" },
          { id: 1, content: "bad id" },
          { id: "m2" },
          "junk",
        ],
        delete: ["m3", 7, false],
        mood: 5,
      }),
    );
    expect(ops).toEqual({
      add: ["ok"],
      update: [{ id: "m1", content: "ok" }],
      delete: ["m3"],
      mood: null,
    });
  });

  it("drops blank adds and blank update contents", () => {
    const ops = parseMemoryOps(
      JSON.stringify({
        add: ["  ", "kept"],
        update: [{ id: "m1", content: "   " }],
      }),
    );
    expect(ops?.add).toEqual(["kept"]);
    expect(ops?.update).toEqual([]);
  });

  it("keeps an empty-string mood (explicit reset to neutral)", () => {
    // "" is a valid mood value — it resets the persona to neutral; only null
    // means "leave unchanged".
    expect(parseMemoryOps('{"mood": ""}')?.mood).toBe("");
  });
});
