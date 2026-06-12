import { describe, it, expect } from "vitest";
import { botAvatarUrl, botMonogram, buildBotSystemText } from "@/lib/bots";

const mem = (...contents: string[]) => contents.map((content) => ({ content }));

describe("buildBotSystemText", () => {
  it("returns empty string when name, instructions, and memory are all blank", () => {
    expect(
      buildBotSystemText({ name: "", tagline: "", instructions: "" }, []),
    ).toBe("");
    expect(
      buildBotSystemText(
        { name: "   ", tagline: "", instructions: "  " },
        mem("  ", ""),
      ),
    ).toBe("");
  });

  it("includes only the persona header for a name-only bot", () => {
    expect(
      buildBotSystemText({ name: "John", tagline: "", instructions: "" }, []),
    ).toBe(
      "You are John, a persona the user created. Stay in character as John.",
    );
  });

  it("folds the tagline into the persona header", () => {
    expect(
      buildBotSystemText(
        { name: "Bjarne", tagline: "The IT architect", instructions: "" },
        [],
      ),
    ).toBe(
      "You are Bjarne (The IT architect), a persona the user created. Stay in character as Bjarne.",
    );
  });

  it("composes header, instructions, and memory, separated by blank lines", () => {
    const out = buildBotSystemText(
      {
        name: "John",
        tagline: "",
        instructions: "Challenge the architecture.",
      },
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

  it("orders sections header → instructions → memory", () => {
    const out = buildBotSystemText(
      { name: "Maria", tagline: "", instructions: "Care about food." },
      mem("Skips breakfast"),
    );
    expect(out.indexOf("You are Maria")).toBeLessThan(
      out.indexOf("Care about food."),
    );
    expect(out.indexOf("Care about food.")).toBeLessThan(out.indexOf("Memory"));
  });

  it("trims memory entries and drops blank rows", () => {
    const out = buildBotSystemText(
      { name: "John", tagline: "", instructions: "" },
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
      { name: "  ", tagline: "", instructions: "Be terse." },
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
