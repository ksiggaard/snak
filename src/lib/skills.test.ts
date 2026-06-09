import { describe, it, expect } from "vitest";
import { buildSkillsSystemText } from "@/lib/skills";
import type { SkillContribution } from "@/types/plugins";

const skill = (name: string, instructions: string): SkillContribution => ({
  name,
  instructions,
});

describe("buildSkillsSystemText", () => {
  it("returns empty string when there are no skills", () => {
    expect(buildSkillsSystemText([])).toBe("");
  });

  it("returns empty string when every skill is blank", () => {
    expect(buildSkillsSystemText([skill("  ", "   "), skill("", "")])).toBe("");
  });

  it("renders a single skill as a headed block under the intro", () => {
    const out = buildSkillsSystemText([
      skill("Concise replies", "Keep answers short and to the point."),
    ]);
    expect(out).toBe(
      "The following skills are available to you. Apply the relevant ones when " +
        "they help with the user's request:\n\n" +
        "## Concise replies\nKeep answers short and to the point.",
    );
  });

  it("renders multiple skills as separate blocks in order", () => {
    const out = buildSkillsSystemText([
      skill("A", "First."),
      skill("B", "Second."),
    ]);
    expect(out).toContain("## A\nFirst.");
    expect(out).toContain("## B\nSecond.");
    expect(out.indexOf("## A")).toBeLessThan(out.indexOf("## B"));
    expect(out.split("\n\n")).toHaveLength(3); // intro + 2 blocks
  });

  it("trims fields and tolerates a missing-instructions skill", () => {
    const out = buildSkillsSystemText([skill("  Named  ", "  ")]);
    expect(out).toContain("## Named");
    expect(out).not.toContain("## Named\n");
  });
});

describe("skills alongside global system context", () => {
  it("omits the layer when no skills are enabled (existing chats unaffected)", () => {
    const skillsText = buildSkillsSystemText([]);
    const history: { role: string; content: string }[] = [
      { role: "user", content: "hi" },
    ];
    if (skillsText) history.unshift({ role: "system", content: skillsText });
    expect(history.map((m) => m.role)).toEqual(["user"]);
  });

  it("unshifts a leading system message when skills are enabled", () => {
    const skillsText = buildSkillsSystemText([skill("X", "Do X.")]);
    const history: { role: string; content: string }[] = [
      { role: "user", content: "hi" },
    ];
    if (skillsText) history.unshift({ role: "system", content: skillsText });
    expect(history.map((m) => m.role)).toEqual(["system", "user"]);
    expect(history[0].content).toContain("## X");
  });
});
