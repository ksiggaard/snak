import { describe, it, expect } from "vitest";
import {
  DEFAULT_QUICK_ACTIONS,
  parseQuickActions,
  resolveQuickActions,
  serializeQuickActions,
  type QuickAction,
} from "@/lib/quickActions";

const action = (over: Partial<QuickAction> = {}): QuickAction => ({
  id: "a1",
  label: "Proof read text",
  prompt: "Proofread:\n\n",
  mode: "prefill",
  ...over,
});

describe("parseQuickActions", () => {
  it("returns [] for null/empty/malformed input", () => {
    expect(parseQuickActions(null)).toEqual([]);
    expect(parseQuickActions("")).toEqual([]);
    expect(parseQuickActions("not json")).toEqual([]);
    expect(parseQuickActions("{}")).toEqual([]); // not an array
    expect(parseQuickActions("[1, 2, 3]")).toEqual([]); // wrong element shape
  });

  it("keeps well-formed entries and preserves order", () => {
    const json = serializeQuickActions([
      action({ id: "x", label: "A", mode: "send" }),
      action({ id: "y", label: "B", mode: "prefill" }),
    ]);
    const parsed = parseQuickActions(json);
    expect(parsed.map((a) => a.id)).toEqual(["x", "y"]);
    expect(parsed[0].mode).toBe("send");
  });

  it("coerces a missing/invalid mode to prefill", () => {
    const parsed = parseQuickActions(
      JSON.stringify([{ id: "x", label: "A", prompt: "p" }]),
    );
    expect(parsed[0].mode).toBe("prefill");
    const bad = parseQuickActions(
      JSON.stringify([{ id: "y", label: "B", prompt: "p", mode: "weird" }]),
    );
    expect(bad[0].mode).toBe("prefill");
  });

  it("drops entries with both label and prompt blank, but keeps prompt-only", () => {
    const parsed = parseQuickActions(
      JSON.stringify([
        { id: "blank", label: "  ", prompt: "  " },
        { id: "keep", label: "", prompt: "do a thing" },
      ]),
    );
    expect(parsed.map((a) => a.id)).toEqual(["keep"]);
  });

  it("assigns an id when one is missing", () => {
    const parsed = parseQuickActions(
      JSON.stringify([{ label: "A", prompt: "p", mode: "send" }]),
    );
    expect(parsed[0].id).toBeTruthy();
  });
});

describe("serializeQuickActions round-trips", () => {
  it("re-parses to the same list", () => {
    const list = [action({ id: "1" }), action({ id: "2", mode: "send" })];
    expect(parseQuickActions(serializeQuickActions(list))).toEqual(list);
  });

  it("round-trips the defaults", () => {
    expect(
      parseQuickActions(serializeQuickActions(DEFAULT_QUICK_ACTIONS)),
    ).toEqual(DEFAULT_QUICK_ACTIONS);
  });
});

describe("resolveQuickActions", () => {
  const global = [action({ id: "g1" }), action({ id: "g2" })];

  it("uses the global list when the project defines none", () => {
    expect(resolveQuickActions(global, null)).toBe(global);
    expect(resolveQuickActions(global, "")).toBe(global);
    expect(resolveQuickActions(global, "[]")).toBe(global);
  });

  it("overrides with the project's list when non-empty", () => {
    const projectJson = serializeQuickActions([action({ id: "p1" })]);
    const resolved = resolveQuickActions(global, projectJson);
    expect(resolved.map((a) => a.id)).toEqual(["p1"]);
  });
});
