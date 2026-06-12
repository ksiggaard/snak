import { describe, it, expect } from "vitest";
import { botAvatarUrl, botMonogram, buildBotSystemText } from "@/lib/bots";

const mem = (...contents: string[]) => contents.map((content) => ({ content }));

/** Profile fixture: everything blank, mood feature on (the column default). */
const profile = (
  over: Partial<Parameters<typeof buildBotSystemText>[0]> = {},
) => ({
  name: "",
  tagline: "",
  instructions: "",
  modus_operandi: "",
  tone_of_voice: "",
  mood_enabled: 1,
  mood: "",
  ...over,
});

describe("buildBotSystemText", () => {
  it("returns empty string when every field and memory is blank", () => {
    expect(buildBotSystemText(profile(), [])).toBe("");
    expect(
      buildBotSystemText(
        profile({
          name: "   ",
          instructions: "  ",
          modus_operandi: " ",
          tone_of_voice: "\n",
          mood: "  ",
        }),
        mem("  ", ""),
      ),
    ).toBe("");
  });

  it("includes only the persona header for a name-only bot", () => {
    expect(buildBotSystemText(profile({ name: "John" }), [])).toBe(
      "You are John, a persona the user created. Stay in character as John.",
    );
  });

  it("folds the tagline into the persona header", () => {
    expect(
      buildBotSystemText(
        profile({ name: "Bjarne", tagline: "The IT architect" }),
        [],
      ),
    ).toBe(
      "You are Bjarne (The IT architect), a persona the user created. Stay in character as Bjarne.",
    );
  });

  it("composes header, instructions, and memory, separated by blank lines", () => {
    const out = buildBotSystemText(
      profile({ name: "John", instructions: "Challenge the architecture." }),
      mem("Prefers TypeScript"),
    );
    expect(out).toBe(
      [
        "You are John, a persona the user created. Stay in character as John.",
        "Challenge the architecture.",
        "Memory (John's notes from previous conversations with this user):\n- Prefers TypeScript",
      ].join("\n\n"),
    );
  });

  it("adds a labeled modus-operandi section when set", () => {
    const out = buildBotSystemText(
      profile({ name: "John", modus_operandi: "Ask before answering." }),
      [],
    );
    expect(out).toBe(
      [
        "You are John, a persona the user created. Stay in character as John.",
        "How you work:\nAsk before answering.",
      ].join("\n\n"),
    );
  });

  it("adds a labeled tone-of-voice section when set", () => {
    const out = buildBotSystemText(
      profile({ name: "John", tone_of_voice: "Warm but direct." }),
      [],
    );
    expect(out).toBe(
      [
        "You are John, a persona the user created. Stay in character as John.",
        "Tone of voice:\nWarm but direct.",
      ].join("\n\n"),
    );
  });

  it("injects the mood when mood_enabled and the mood is non-blank", () => {
    const out = buildBotSystemText(
      profile({ name: "John", mood_enabled: 1, mood: "cheerful" }),
      [],
    );
    expect(out).toBe(
      [
        "You are John, a persona the user created. Stay in character as John.",
        "Your current mood: cheerful\nLet it subtly color your responses; don't mention it unprompted.",
      ].join("\n\n"),
    );
  });

  it("omits the mood when mood_enabled is 0, even with a mood set", () => {
    const out = buildBotSystemText(
      profile({ name: "John", mood_enabled: 0, mood: "cheerful" }),
      [],
    );
    expect(out).not.toContain("mood");
    expect(out).not.toContain("cheerful");
  });

  it("omits the mood section for a blank mood", () => {
    const out = buildBotSystemText(
      profile({ name: "John", mood_enabled: 1, mood: "   " }),
      [],
    );
    expect(out).not.toContain("mood");
  });

  it("orders sections header → personality → modus operandi → tone → mood → memory", () => {
    const out = buildBotSystemText(
      profile({
        name: "Maria",
        instructions: "Care about food.",
        modus_operandi: "Plan meals first.",
        tone_of_voice: "Playful.",
        mood_enabled: 1,
        mood: "hungry",
      }),
      mem("Skips breakfast"),
    );
    expect(out.indexOf("You are Maria")).toBeLessThan(
      out.indexOf("Care about food."),
    );
    expect(out.indexOf("Care about food.")).toBeLessThan(
      out.indexOf("How you work:"),
    );
    expect(out.indexOf("How you work:")).toBeLessThan(
      out.indexOf("Tone of voice:"),
    );
    expect(out.indexOf("Tone of voice:")).toBeLessThan(
      out.indexOf("Your current mood:"),
    );
    expect(out.indexOf("Your current mood:")).toBeLessThan(
      out.indexOf("Memory"),
    );
  });

  it("trims memory entries and drops blank rows", () => {
    const out = buildBotSystemText(
      profile({ name: "John" }),
      mem("  kept  ", "   ", ""),
    );
    expect(out).toBe(
      [
        "You are John, a persona the user created. Stay in character as John.",
        "Memory (John's notes from previous conversations with this user):\n- kept",
      ].join("\n\n"),
    );
  });

  it("includes instructions and memory even when the name is blank", () => {
    const out = buildBotSystemText(
      profile({ name: "  ", instructions: "Be terse." }),
      mem("A fact"),
    );
    expect(out).toBe(
      [
        "Be terse.",
        "Memory ('s notes from previous conversations with this user):\n- A fact",
      ].join("\n\n"),
    );
    expect(out).not.toContain("You are");
  });
});

describe("botAvatarUrl", () => {
  it("returns null when either avatar field is null", () => {
    expect(botAvatarUrl({ avatar_media_type: null, avatar_data: null })).toBe(
      null,
    );
    expect(
      botAvatarUrl({ avatar_media_type: "image/jpeg", avatar_data: null }),
    ).toBe(null);
    expect(botAvatarUrl({ avatar_media_type: null, avatar_data: "abc=" })).toBe(
      null,
    );
  });

  it("builds a data URL from the media type and base64 payload", () => {
    expect(
      botAvatarUrl({ avatar_media_type: "image/jpeg", avatar_data: "abc=" }),
    ).toBe("data:image/jpeg;base64,abc=");
  });
});

describe("botMonogram", () => {
  it("uppercases the first character of the name", () => {
    expect(botMonogram("john")).toBe("J");
    expect(botMonogram("Maria")).toBe("M");
  });

  it("falls back to '?' for a blank name", () => {
    expect(botMonogram("")).toBe("?");
    expect(botMonogram("   ")).toBe("?");
  });

  it("keeps an emoji first grapheme intact (code-point safe)", () => {
    expect(botMonogram("🤖 Bot")).toBe("🤖");
  });
});
