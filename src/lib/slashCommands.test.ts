import { describe, expect, it } from "vitest";
import {
  applyTemplate,
  availableCommands,
  BUILTIN_COMMANDS,
  matchCommands,
  normalizeUserCommand,
  parseSlashInput,
  parseUserCommands,
  resolveCommand,
  type UserSlashCommand,
} from "@/lib/slashCommands";
import type { SlashCommandContribution } from "@/types/plugins";

const user = (
  command: string,
  instructions = "",
  input = "",
): UserSlashCommand => ({ id: command, command, input, instructions });

describe("parseSlashInput", () => {
  it("parses a command with args", () => {
    expect(parseSlashInput("/terminal ls -la /tmp")).toEqual({
      name: "terminal",
      args: "ls -la /tmp",
    });
  });

  it("parses a bare command with no args", () => {
    expect(parseSlashInput("/terminal")).toEqual({ name: "terminal", args: "" });
  });

  it("lowercases the command name", () => {
    expect(parseSlashInput("/Terminal echo hi")?.name).toBe("terminal");
  });

  it("trims surrounding whitespace in args and tolerates extra spaces", () => {
    expect(parseSlashInput("/terminal    echo hi   ")).toEqual({
      name: "terminal",
      args: "echo hi",
    });
  });

  it("preserves internal newlines/whitespace of multi-line args", () => {
    expect(parseSlashInput("/terminal echo a\necho b")?.args).toBe(
      "echo a\necho b",
    );
  });

  it("returns null for normal text", () => {
    expect(parseSlashInput("hello world")).toBeNull();
  });

  it("returns null when a slash appears mid-line", () => {
    expect(parseSlashInput("see foo/bar")).toBeNull();
  });

  it("returns null for a leading space before the slash (normal message)", () => {
    expect(parseSlashInput(" /terminal ls")).toBeNull();
  });

  it("treats a doubled leading slash as a literal (not a command)", () => {
    expect(parseSlashInput("//not a command")).toBeNull();
  });

  it("rejects an invalid command word", () => {
    expect(parseSlashInput("/ leading")).toBeNull();
    expect(parseSlashInput("/-bad")).toBeNull();
  });

  it("accepts dashes and underscores after the first char", () => {
    expect(parseSlashInput("/web_search foo")?.name).toBe("web_search");
    expect(parseSlashInput("/web-search foo")?.name).toBe("web-search");
  });
});

describe("availableCommands", () => {
  it("includes the built-in /terminal", () => {
    const cmds = availableCommands([]);
    expect(cmds.find((c) => c.command === "/terminal")?.kind).toBe("terminal");
  });

  it("folds in plugin contributions as declarative note commands", () => {
    const contribs: SlashCommandContribution[] = [
      { command: "/summarize", description: "Summarize the page" },
    ];
    const cmds = availableCommands(contribs);
    const sum = cmds.find((c) => c.command === "/summarize");
    expect(sum).toMatchObject({
      kind: "note",
      source: "plugin",
      description: "Summarize the page",
    });
  });

  it("normalizes a plugin command word lacking a leading slash", () => {
    const cmds = availableCommands([
      { command: "weather", description: "Get weather" },
    ]);
    expect(cmds.some((c) => c.command === "/weather")).toBe(true);
  });

  it("lets a built-in win over a plugin of the same name", () => {
    const cmds = availableCommands([
      { command: "/terminal", description: "evil override" },
    ]);
    const term = cmds.filter((c) => c.command === "/terminal");
    expect(term).toHaveLength(1);
    expect(term[0].source).toBe("builtin");
  });

  it("skips blank or malformed plugin command words", () => {
    const cmds = availableCommands([
      { command: "   ", description: "blank" },
      { command: "/bad word", description: "has space" },
    ]);
    expect(cmds).toHaveLength(BUILTIN_COMMANDS.length);
  });

  it("returns commands sorted by name", () => {
    const cmds = availableCommands([
      { command: "/zeta", description: "z" },
      { command: "/alpha", description: "a" },
    ]);
    const names = cmds.map((c) => c.command);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("matchCommands", () => {
  const cmds = availableCommands([
    { command: "/summarize", description: "s" },
    { command: "/search", description: "s" },
  ]);

  it("lists all for an empty or slash-only prefix", () => {
    expect(matchCommands("", cmds)).toHaveLength(cmds.length);
    expect(matchCommands("/", cmds)).toHaveLength(cmds.length);
  });

  it("filters by prefix, ignoring the leading slash and case", () => {
    expect(matchCommands("/se", cmds).map((c) => c.command)).toEqual([
      "/search",
    ]);
    expect(matchCommands("SU", cmds).map((c) => c.command)).toEqual([
      "/summarize",
    ]);
  });

  it("returns nothing for a non-matching prefix", () => {
    expect(matchCommands("/xyz", cmds)).toHaveLength(0);
  });
});

describe("resolveCommand", () => {
  const cmds = availableCommands([]);

  it("resolves a known command", () => {
    const parsed = parseSlashInput("/terminal ls")!;
    expect(resolveCommand(parsed, cmds)?.command).toBe("/terminal");
  });

  it("returns null for an unknown command", () => {
    const parsed = parseSlashInput("/nope x")!;
    expect(resolveCommand(parsed, cmds)).toBeNull();
  });
});

describe("built-in shortcut commands", () => {
  it("ships /compact, /research and /help", () => {
    const cmds = availableCommands([]);
    expect(cmds.find((c) => c.command === "/compact")?.kind).toBe("compact");
    expect(cmds.find((c) => c.command === "/research")?.kind).toBe("research");
    expect(cmds.find((c) => c.command === "/help")?.kind).toBe("help");
  });
});

describe("applyTemplate", () => {
  it("substitutes {input} with the typed args", () => {
    expect(applyTemplate("Fix grammar:\n{input}\nthanks", "hello")).toBe(
      "Fix grammar:\nhello\nthanks",
    );
  });

  it("replaces every {input} occurrence", () => {
    expect(applyTemplate("{input} / {input}", "x")).toBe("x / x");
  });

  it("appends args after the instructions when there is no placeholder", () => {
    expect(applyTemplate("Proofread this", "my text")).toBe(
      "Proofread this\n\nmy text",
    );
  });

  it("sends the instructions as-is when args are empty", () => {
    expect(applyTemplate("Tell me a joke", "   ")).toBe("Tell me a joke");
  });
});

describe("availableCommands with user commands", () => {
  it("folds a user command in as a prompt command", () => {
    const cmds = availableCommands(
      [],
      [user("/proof-read", "Fix grammar", "text to fix")],
    );
    const pr = cmds.find((c) => c.command === "/proof-read");
    expect(pr).toMatchObject({
      kind: "prompt",
      source: "user",
      description: "text to fix",
      instructions: "Fix grammar",
    });
  });

  it("normalizes a user command word (leading slash + lowercase)", () => {
    const cmds = availableCommands([], [user("Proof_Read", "x")]);
    expect(cmds.some((c) => c.command === "/proof_read")).toBe(true);
  });

  it("skips a user command with an invalid word", () => {
    const before = availableCommands([]).length;
    const cmds = availableCommands([], [user("/bad word", "x"), user("", "y")]);
    expect(cmds).toHaveLength(before);
  });

  it("honors precedence built-in > user > plugin", () => {
    // A built-in name wins over a user command of the same name.
    const overBuiltin = availableCommands(
      [],
      [user("/compact", "hijack")],
    ).filter((c) => c.command === "/compact");
    expect(overBuiltin).toHaveLength(1);
    expect(overBuiltin[0].source).toBe("builtin");

    // A user command wins over a plugin contribution of the same name.
    const contribs: SlashCommandContribution[] = [
      { command: "/summarize", description: "from plugin" },
    ];
    const cmds = availableCommands(contribs, [user("/summarize", "from user")]);
    const sum = cmds.filter((c) => c.command === "/summarize");
    expect(sum).toHaveLength(1);
    expect(sum[0].source).toBe("user");
  });
});

describe("normalizeUserCommand", () => {
  it("adds a leading slash and lowercases", () => {
    expect(normalizeUserCommand("Proof-Read")).toBe("/proof-read");
    expect(normalizeUserCommand("/Hello")).toBe("/hello");
  });

  it("returns null for invalid words", () => {
    expect(normalizeUserCommand("")).toBeNull();
    expect(normalizeUserCommand("/bad word")).toBeNull();
    expect(normalizeUserCommand("/-nope")).toBeNull();
  });
});

describe("parseUserCommands", () => {
  it("returns [] for null/empty/malformed input", () => {
    expect(parseUserCommands(null)).toEqual([]);
    expect(parseUserCommands("")).toEqual([]);
    expect(parseUserCommands("not json")).toEqual([]);
    expect(parseUserCommands('{"not":"array"}')).toEqual([]);
  });

  it("keeps well-formed entries and drops command-less ones", () => {
    const json = JSON.stringify([
      { id: "a", command: "/x", input: "i", instructions: "do x" },
      { input: "no command" },
      { id: "b", command: "  " },
    ]);
    const out = parseUserCommands(json);
    expect(out).toEqual([
      { id: "a", command: "/x", input: "i", instructions: "do x" },
    ]);
  });
});
