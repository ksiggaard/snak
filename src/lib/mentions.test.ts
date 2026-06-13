import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  extractMentions,
  insertMention,
  matchMentionBots,
} from "@/lib/mentions";

const bot = (id: string, name: string) => ({ id, name });

describe("activeMentionQuery", () => {
  it("detects an @ at the start of the text", () => {
    expect(activeMentionQuery("@Jo", 3)).toEqual({
      start: 0,
      end: 3,
      query: "Jo",
    });
  });

  it("detects an @ after whitespace mid-text", () => {
    expect(activeMentionQuery("hey @Ma", 7)).toEqual({
      start: 4,
      end: 7,
      query: "Ma",
    });
  });

  it("detects an @ after a newline", () => {
    expect(activeMentionQuery("hello\n@J", 8)).toEqual({
      start: 6,
      end: 8,
      query: "J",
    });
  });

  it("returns an empty query for a bare @", () => {
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("is null for an email-style @ (no whitespace before)", () => {
    expect(activeMentionQuery("kasper@merkle", 13)).toBeNull();
  });

  it("is null when whitespace separates the @ from the caret", () => {
    expect(activeMentionQuery("@John hello", 11)).toBeNull();
  });

  it("is null when the caret sits before the @", () => {
    expect(activeMentionQuery("hi @John", 2)).toBeNull();
  });

  it("extends end to the rest of the token when the caret is mid-token", () => {
    // caret between "Ja" and "ne": the whole token is replaced on pick.
    expect(activeMentionQuery("ask @Jane about it", 7)).toEqual({
      start: 4,
      end: 9,
      query: "Ja",
    });
  });

  it("is null with no @ at all", () => {
    expect(activeMentionQuery("plain text", 5)).toBeNull();
  });
});

describe("matchMentionBots", () => {
  const bots = [bot("1", "Maria"), bot("2", "John"), bot("3", "Jane Doe")];

  it("filters by case-insensitive name prefix", () => {
    expect(matchMentionBots("jo", bots).map((b) => b.name)).toEqual(["John"]);
  });

  it("lists all for an empty query, sorted by name", () => {
    expect(matchMentionBots("", bots).map((b) => b.name)).toEqual([
      "Jane Doe",
      "John",
      "Maria",
    ]);
  });

  it("matches a multi-word name by its first-word prefix", () => {
    expect(matchMentionBots("jan", bots).map((b) => b.name)).toEqual([
      "Jane Doe",
    ]);
  });

  it("skips blank-named bots and returns [] on no match", () => {
    expect(matchMentionBots("", [bot("1", "  ")])).toEqual([]);
    expect(matchMentionBots("zzz", bots)).toEqual([]);
  });
});

describe("extractMentions", () => {
  const bots = [
    bot("bob", "Bob"),
    bot("jane", "Jane"),
    bot("janedoe", "Jane Doe"),
  ];

  it("resolves a simple mention case-insensitively", () => {
    expect(extractMentions("@bob what do you think?", bots)).toEqual([
      bot("bob", "Bob"),
    ]);
  });

  it("returns [] for unknown names (plain text)", () => {
    expect(extractMentions("@nobody hi", bots)).toEqual([]);
  });

  it("prefers the longest matching name at an anchor", () => {
    expect(extractMentions("@Jane Doe hi", bots)).toEqual([
      bot("janedoe", "Jane Doe"),
    ]);
  });

  it("matches the shorter name when the longer one doesn't fit", () => {
    expect(extractMentions("@Jane what's up", bots)).toEqual([
      bot("jane", "Jane"),
    ]);
  });

  it("accepts punctuation as a boundary after the name", () => {
    expect(extractMentions("@Bob, your take?", bots)).toEqual([
      bot("bob", "Bob"),
    ]);
  });

  it("does not match a name that runs into more word characters", () => {
    expect(extractMentions("@Bobby hi", bots)).toEqual([]);
  });

  it("never matches an email-style @", () => {
    expect(extractMentions("mail bob@bob.example please", bots)).toEqual([]);
  });

  it("ignores an @ followed by a space", () => {
    expect(extractMentions("@ Bob hi", bots)).toEqual([]);
  });

  it("dedupes by id and preserves first-mention order", () => {
    expect(
      extractMentions("@Jane then @Bob then @Jane again", bots).map(
        (b) => b.id,
      ),
    ).toEqual(["jane", "bob"]);
  });

  it("collects multiple mentions in order", () => {
    expect(
      extractMentions("@Bob @Jane Doe weigh in", bots).map((b) => b.id),
    ).toEqual(["bob", "janedoe"]);
  });

  it("handles regex metacharacters in names literally", () => {
    const weird = [bot("cpp", "C++ Bot")];
    expect(extractMentions("@c++ bot help", weird)).toEqual(weird);
    expect(extractMentions("@c hi", weird)).toEqual([]);
  });

  it("handles mentions after newlines and at the very start", () => {
    expect(extractMentions("hi\n@Bob\nthanks", bots)).toEqual([
      bot("bob", "Bob"),
    ]);
  });

  it("returns [] with no @ or no usable bots", () => {
    expect(extractMentions("no mentions here", bots)).toEqual([]);
    expect(extractMentions("@Bob", [bot("1", " ")])).toEqual([]);
  });

  it("a bare @Name with no question still resolves", () => {
    expect(extractMentions("@Bob", bots)).toEqual([bot("bob", "Bob")]);
  });
});

describe("insertMention", () => {
  it("replaces the token at the start", () => {
    const q = activeMentionQuery("@Jo", 3)!;
    expect(insertMention("@Jo", q, "John")).toEqual({
      text: "@John ",
      caret: 6,
    });
  });

  it("replaces a mid-text token, keeping surrounding text", () => {
    const q = activeMentionQuery("ask @Ja about it", 7)!;
    expect(insertMention("ask @Ja about it", q, "Jane Doe")).toEqual({
      text: "ask @Jane Doe  about it",
      caret: 14,
    });
  });

  it("replaces the whole token when the caret was mid-token", () => {
    const text = "ask @Jane about it";
    const q = activeMentionQuery(text, 7)!; // caret inside "@Jane"
    expect(insertMention(text, q, "Jane Doe").text).toBe(
      "ask @Jane Doe  about it",
    );
  });

  it("closes the palette after insertion (trailing space rule)", () => {
    const r = insertMention("@Jo", activeMentionQuery("@Jo", 3)!, "John");
    expect(activeMentionQuery(r.text, r.caret)).toBeNull();
  });
});
