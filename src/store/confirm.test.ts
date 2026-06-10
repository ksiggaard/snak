import { describe, expect, it } from "vitest";
import { confirmDialog, useConfirm } from "./confirm";

describe("confirm store", () => {
  it("opens, then resolves true when confirmed", async () => {
    const p = confirmDialog({ title: "Delete?" });
    expect(useConfirm.getState().open).toBe(true);
    expect(useConfirm.getState().options?.title).toBe("Delete?");

    useConfirm.getState().respond(true);
    await expect(p).resolves.toBe(true);
    // Closed and cleared after responding.
    expect(useConfirm.getState().open).toBe(false);
    expect(useConfirm.getState().options).toBeNull();
  });

  it("resolves false when cancelled", async () => {
    const p = confirmDialog({ title: "Remove?" });
    useConfirm.getState().respond(false);
    await expect(p).resolves.toBe(false);
  });

  it("auto-cancels a previously pending dialog if a new one opens", async () => {
    const first = confirmDialog({ title: "First" });
    const second = confirmDialog({ title: "Second" });
    await expect(first).resolves.toBe(false);
    expect(useConfirm.getState().options?.title).toBe("Second");
    useConfirm.getState().respond(true);
    await expect(second).resolves.toBe(true);
  });
});
