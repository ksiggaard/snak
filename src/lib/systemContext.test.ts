import { describe, it, expect } from "vitest";
import { buildGlobalSystemText } from "@/lib/systemContext";
import { buildProjectSystemText } from "@/lib/projects";

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
    expect(buildGlobalSystemText("", mem("Likes TypeScript", "Lives in Aarhus"))).toBe(
      "Memory about the user:\n- Likes TypeScript\n- Lives in Aarhus",
    );
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
    const out = buildGlobalSystemText("  Trim me  ", mem("  kept  ", "   ", ""));
    expect(out).toBe("Trim me\n\nMemory about the user:\n- kept");
  });
});

describe("system-context precedence (global → project → thread)", () => {
  it("orders global ahead of project when both are present", () => {
    // Mirrors how store/threads.ts assembles the leading system messages: the
    // project message is unshifted first, the global message second, so the
    // array ends up [global, project, ...history].
    const globalText = buildGlobalSystemText("Global rule.", mem("A user fact"));
    const projectText = buildProjectSystemText(
      { name: "Acme", instructions: "Project rule." },
      [],
    );

    const history: { role: string; content: string }[] = [
      { role: "user", content: "hello" },
    ];
    if (projectText) history.unshift({ role: "system", content: projectText });
    if (globalText) history.unshift({ role: "system", content: globalText });

    expect(history.map((m) => m.role)).toEqual(["system", "system", "user"]);
    expect(history[0].content).toBe(globalText);
    expect(history[0].content).toContain("Global rule.");
    expect(history[0].content).toContain("A user fact");
    expect(history[1].content).toBe(projectText);
    expect(history[1].content).toContain("Project rule.");
  });

  it("omits empty layers so existing chats are unaffected when nothing is set", () => {
    const globalText = buildGlobalSystemText("", []);
    const projectText = buildProjectSystemText(
      { name: "Acme", instructions: "" },
      [],
    );
    const history: { role: string; content: string }[] = [
      { role: "user", content: "hello" },
    ];
    if (projectText) history.unshift({ role: "system", content: projectText });
    if (globalText) history.unshift({ role: "system", content: globalText });

    expect(history.map((m) => m.role)).toEqual(["user"]);
  });
});
