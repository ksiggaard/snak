import { describe, expect, it } from "vitest";
import {
  LOADING_MESSAGE_KEYS,
  pickLoadingMessage,
} from "@/lib/loadingMessages";

describe("pickLoadingMessage", () => {
  const pool = ["a", "b", "c"];

  it("returns the first item at tick 0", () => {
    expect(pickLoadingMessage(0, pool)).toBe("a");
  });

  it("advances through the pool with each tick", () => {
    expect(pickLoadingMessage(1, pool)).toBe("b");
    expect(pickLoadingMessage(2, pool)).toBe("c");
  });

  it("wraps around when tick exceeds pool length", () => {
    expect(pickLoadingMessage(3, pool)).toBe("a");
    expect(pickLoadingMessage(4, pool)).toBe("b");
    expect(pickLoadingMessage(5, pool)).toBe("c");
    expect(pickLoadingMessage(6, pool)).toBe("a");
  });

  it("works with a single-item pool", () => {
    expect(pickLoadingMessage(0, ["only"])).toBe("only");
    expect(pickLoadingMessage(99, ["only"])).toBe("only");
  });

  it("uses LOADING_MESSAGE_KEYS as the default pool", () => {
    expect(pickLoadingMessage(0)).toBe(LOADING_MESSAGE_KEYS[0]);
    expect(pickLoadingMessage(LOADING_MESSAGE_KEYS.length)).toBe(
      LOADING_MESSAGE_KEYS[0],
    );
  });

  it("covers every key in the default pool exactly once per cycle", () => {
    const seen = new Set<string>();
    const n = LOADING_MESSAGE_KEYS.length;
    for (let i = 0; i < n; i++) {
      seen.add(pickLoadingMessage(i));
    }
    expect(seen.size).toBe(n);
    for (const k of LOADING_MESSAGE_KEYS) {
      expect(seen.has(k)).toBe(true);
    }
  });

  it("handles large tick values without overflow issues", () => {
    const bigTick = 1_000_003;
    const expected = pool[bigTick % pool.length];
    expect(pickLoadingMessage(bigTick, pool)).toBe(expected);
  });
});
