import { describe, it, expect } from "vitest";
import {
  buildGlobalSystemText,
  buildWorkspaceMemoryText,
} from "@/lib/systemContext";
import { buildWorkspaceSystemText } from "@/lib/workspaces";

const mem = (...contents: string[]) => contents.map((content) => ({ content }));

describe("buildGlobalSystemText", () => {
  it("returns empty string when addendum and memory are both empty", () => {
    expect(buildGlobalSystemText("", [])).toBe("");
    expect(buildGlobalSystemText(null, [])).toBe("");
    expect(buildGlobalSystemText(undefined, mem("  ", ""))).toBe("");
  });

  it("includes only the addendum when there is no memory", () => {
    expect(buildGlobalSystemText("Be concise.", [])).toBe("Be concise.");
  });

  it("includes only memory when there is no addendum, as a bulleted block", () => {
    expect(
      buildGlobalSystemText("", mem("Likes TypeScript", "Lives in Aarhus")),
    ).toBe("Memory about the user:\n- Likes TypeScript\n- Lives in Aarhus");
  });

  it("combines addendum then memory, separated by a blank line", () => {
    const out = buildGlobalSystemText("Be concise.", mem("Likes TypeScript"));
    expect(out).toBe(
      "Be concise.\n\nMemory about the user:\n- Likes TypeScript",
    );
    // Addendum precedes memory.
    expect(out.indexOf("Be concise.")).toBeLessThan(out.indexOf("Memory"));
  });

  it("trims entries and drops blank memory rows", () => {
    const out = buildGlobalSystemText(
      "  Trim me  ",
      mem("  kept  ", "   ", ""),
    );
    expect(out).toBe("Trim me\n\nMemory about the user:\n- kept");
  });
});

describe("system-context precedence (global → workspace → thread)", () => {
  it("orders global ahead of workspace when both are present", () => {
    // Mirrors how store/threads.ts assembles the leading system messages: the
    // workspace message is unshifted first, the global message second, so the
    // array ends up [global, workspace, ...history].
    const globalText = buildGlobalSystemText(
      "Global rule.",
      mem("A user fact"),
    );
    const workspaceText = buildWorkspaceSystemText(
      { name: "Acme", instructions: "Workspace rule." },
      [],
    );

    const history: { role: string; content: string }[] = [
      { role: "user", content: "hello" },
    ];
    if (workspaceText)
      history.unshift({ role: "system", content: workspaceText });
    if (globalText) history.unshift({ role: "system", content: globalText });

    expect(history.map((m) => m.role)).toEqual(["system", "system", "user"]);
    expect(history[0].content).toBe(globalText);
    expect(history[0].content).toContain("Global rule.");
    expect(history[0].content).toContain("A user fact");
    expect(history[1].content).toBe(workspaceText);
    expect(history[1].content).toContain("Workspace rule.");
  });

  it("omits empty layers so existing chats are unaffected when nothing is set", () => {
    const globalText = buildGlobalSystemText("", []);
    const workspaceText = buildWorkspaceSystemText(
      { name: "Acme", instructions: "" },
      [],
    );
    const history: { role: string; content: string }[] = [
      { role: "user", content: "hello" },
    ];
    if (workspaceText)
      history.unshift({ role: "system", content: workspaceText });
    if (globalText) history.unshift({ role: "system", content: globalText });

    expect(history.map((m) => m.role)).toEqual(["user"]);
  });
});

describe("buildWorkspaceMemoryText (T62)", () => {
  const wsMem = (...contents: string[]) =>
    contents.map((content) => ({ content, workspace_id: "ws1" }));

  it("returns empty string when there are no entries", () => {
    expect(buildWorkspaceMemoryText([])).toBe("");
  });

  it("returns empty string when all entries are blank/whitespace", () => {
    expect(buildWorkspaceMemoryText(wsMem("  ", "", "   "))).toBe("");
  });

  it("formats a single entry as a labeled bulleted block", () => {
    expect(buildWorkspaceMemoryText(wsMem("Uses Acme v2 API"))).toBe(
      "Memory for this workspace:\n- Uses Acme v2 API",
    );
  });

  it("formats multiple entries as a labeled bulleted list", () => {
    expect(
      buildWorkspaceMemoryText(wsMem("Uses Acme v2 API", "Prefer TypeScript")),
    ).toBe(
      "Memory for this workspace:\n- Uses Acme v2 API\n- Prefer TypeScript",
    );
  });

  it("trims individual entries and skips blank ones", () => {
    expect(
      buildWorkspaceMemoryText(wsMem("  trimmed  ", "   ", "also kept")),
    ).toBe("Memory for this workspace:\n- trimmed\n- also kept");
  });

  it("uses a different heading than global memory", () => {
    const wsText = buildWorkspaceMemoryText(wsMem("workspace fact"));
    const globalText = buildGlobalSystemText("", mem("user fact"));
    expect(wsText).toContain("Memory for this workspace:");
    expect(globalText).toContain("Memory about the user:");
    expect(wsText).not.toContain("Memory about the user:");
    expect(globalText).not.toContain("Memory for this workspace:");
  });
});
