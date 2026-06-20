import { describe, it, expect } from "vitest";
import { createGate } from "./concurrency";

describe("createGate", () => {
  it("runs non-local tasks immediately in parallel", async () => {
    const gate = createGate();
    const order: string[] = [];
    const a = gate(false, () => delay(20).then(() => order.push("a")));
    const b = gate(false, () => delay(10).then(() => order.push("b")));
    await Promise.all([a, b]);
    expect(order).toEqual(["b", "a"]);
  });

  it("serializes local tasks", async () => {
    const gate = createGate();
    const order: string[] = [];
    const a = gate(true, () => delay(20).then(() => order.push("a")));
    const b = gate(true, () => delay(10).then(() => order.push("b")));
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });

  it("runs local and non-local concurrently", async () => {
    const gate = createGate();
    const order: string[] = [];
    const a = gate(true, () => delay(20).then(() => order.push("local")));
    const b = gate(false, () => delay(5).then(() => order.push("cloud")));
    await Promise.all([a, b]);
    expect(order).toEqual(["cloud", "local"]);
  });

  it("preserves return values", async () => {
    const gate = createGate();
    const r1 = await gate(false, () => Promise.resolve(42));
    const r2 = await gate(true, () => Promise.resolve("hello"));
    expect(r1).toBe(42);
    expect(r2).toBe("hello");
  });

  it("propagates errors", async () => {
    const gate = createGate();
    await expect(
      gate(false, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
