import { describe, expect, it } from "vitest";
import {
  applyRegenSteer,
  planVariants,
  regenSteer,
  type VariantRow,
} from "@/lib/variations";

/** Build a minimal variant row. */
function row(
  id: string,
  group: string | null,
  selected = 1,
): VariantRow & { tag: string } {
  return { id, variant_group: group, variant_selected: selected, tag: id };
}

describe("planVariants", () => {
  it("passes ungrouped rows through 1:1, in order", () => {
    const rows = [row("u1", null), row("a1", "a1"), row("u2", null)];
    const slots = planVariants(rows);
    expect(slots.map((s) => s.emit.id)).toEqual(["u1", "a1", "u2"]);
    expect(slots.map((s) => s.variantIds)).toEqual([null, ["a1"], null]);
  });

  it("collapses a group to its selected variant at the anchor position", () => {
    // a1 is the original/anchor (group === id); a2 is a regeneration (selected).
    const rows = [
      row("u1", null),
      row("a1", "a1", 0),
      row("a2", "a1", 1),
    ];
    const slots = planVariants(rows);
    expect(slots.map((s) => s.emit.id)).toEqual(["u1", "a2"]);
    // The variant slot exposes every sibling id in generation order.
    expect(slots[1].variantIds).toEqual(["a1", "a2"]);
  });

  it("keeps the group anchored even when a later variant is selected", () => {
    // A follow-up exchange exists after the group; selecting an earlier variant
    // must not move the slot past the later user turn.
    const rows = [
      row("a1", "a1", 1), // selected = the original
      row("u2", null),
      row("a3", "a3"), // a different, later group
      row("a2", "a1", 0), // a regeneration of the FIRST group, created late
    ];
    const slots = planVariants(rows);
    expect(slots.map((s) => s.emit.id)).toEqual(["a1", "u2", "a3"]);
    expect(slots[0].variantIds).toEqual(["a1", "a2"]);
  });

  it("falls back to the first sibling when no variant is selected", () => {
    const rows = [row("a1", "a1", 0), row("a2", "a1", 0)];
    const slots = planVariants(rows);
    expect(slots).toHaveLength(1);
    expect(slots[0].emit.id).toBe("a1");
  });
});

describe("regenSteer / applyRegenSteer", () => {
  it("includes the direction when given, omits it otherwise", () => {
    expect(regenSteer("")).not.toContain("Apply this direction");
    expect(regenSteer("more formal")).toContain(
      "Apply this direction: more formal.",
    );
  });

  it("appends the steer to the final user turn", () => {
    const history = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ];
    const out = applyRegenSteer(history, "shorter", (content) => ({
      role: "user",
      content,
    }));
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[1].role).toBe("user");
    expect(out[1].content.startsWith("hello")).toBe(true);
    expect(out[1].content).toContain("Apply this direction: shorter.");
    // The source array is not mutated.
    expect(history[1].content).toBe("hello");
  });

  it("appends a fresh user turn when none trails the history", () => {
    const history = [{ role: "system", content: "sys" }];
    const out = applyRegenSteer(history, "", (content) => ({
      role: "user",
      content,
    }));
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe("user");
  });
});
