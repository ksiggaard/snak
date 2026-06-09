import { describe, expect, it } from "vitest";
import {
  availableCommands,
  BUILTIN_COMMANDS,
  matchCommands,
  parseSlashInput,
  resolveCommand,
} from "@/lib/slashCommands";
import type { SlashCommandContribution } from "@/types/plugins";

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
