import { describe, it, expect } from "vitest";
import { buildSkillsIndexText, type SkillMeta } from "@/lib/skills";

const skill = (name: string, description: string): SkillMeta => ({
  name,
  description,
  enabled: true,
  slug: name.trim().toLowerCase(),
});

describe("buildSkillsIndexText", () => {
  it("returns empty string when there are no skills", () => {
    expect(buildSkillsIndexText([])).toBe("");
  });

  it("returns empty string when every skill has a blank name", () => {
    expect(buildSkillsIndexText([skill("  ", "x"), skill("", "")])).toBe("");
  });

  it("lists each skill by name + description and names the load tool", () => {
    const out = buildSkillsIndexText([
      skill("SQL Style", "House SQL conventions"),
    ]);
    expect(out).toContain("skill__load_skill");
    expect(out).toContain("- SQL Style: House SQL conventions");
    // The body is NOT in the index — only name + description (no pollution).
    expect(out).not.toContain("conventions\nUPPERCASE");
  });

  it("renders multiple skills as separate lines in order", () => {
    const out = buildSkillsIndexText([skill("A", "first"), skill("B", "second")]);
    expect(out).toContain("- A: first");
    expect(out).toContain("- B: second");
    expect(out.indexOf("- A")).toBeLessThan(out.indexOf("- B"));
  });

  it("omits the description when blank", () => {
    const out = buildSkillsIndexText([skill("Bare", "   ")]);
    expect(out).toContain("- Bare");
    expect(out).not.toContain("- Bare:");
  });
});

describe("skills index as a leading system block", () => {
  it("omits the layer when no skills are enabled (chats unaffected)", () => {
    const text = buildSkillsIndexText([]);
    const history: { role: string; content: string }[] = [
      { role: "user", content: "hi" },
    ];
    if (text) history.unshift({ role: "system", content: text });
    expect(history.map((m) => m.role)).toEqual(["user"]);
  });

  it("unshifts a leading system message when skills exist", () => {
    const text = buildSkillsIndexText([skill("X", "Do X.")]);
    const history: { role: string; content: string }[] = [
      { role: "user", content: "hi" },
    ];
    if (text) history.unshift({ role: "system", content: text });
    expect(history.map((m) => m.role)).toEqual(["system", "user"]);
    expect(history[0].content).toContain("- X: Do X.");
  });
});
