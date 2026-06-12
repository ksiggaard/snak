import { describe, it, expect } from "vitest";
import {
  recentDestinations,
  cycleDestination,
  destinationThreadId,
  MAX_RECENTS,
} from "@/lib/quickDestinations";

const t = (id: string, title: string, updated_at: string) => ({
  id,
  title,
  updated_at,
});

describe("recentDestinations", () => {
  it("returns at most MAX_RECENTS threads as {id, title}", () => {
    const threads = Array.from({ length: 8 }, (_, i) =>
      t(`id${i}`, `Thread ${i}`, `2026-06-1${i % 10} 10:00:0${i}`),
    );
    const recents = recentDestinations(threads);
    expect(recents).toHaveLength(MAX_RECENTS);
    expect(recents[0]).toEqual({ id: "id7", title: "Thread 7" });
  });

  it("orders by updated_at descending regardless of input order", () => {
    const recents = recentDestinations([
      t("a", "Old", "2026-06-01 09:00:00"),
      t("b", "New", "2026-06-12 09:00:00"),
      t("c", "Mid", "2026-06-05 09:00:00"),
    ]);
    expect(recents.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("handles fewer threads than max, and none", () => {
    expect(recentDestinations([t("a", "A", "2026-06-01 00:00:00")])).toEqual([
      { id: "a", title: "A" },
    ]);
    expect(recentDestinations([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const threads = [
      t("a", "A", "2026-06-01 00:00:00"),
      t("b", "B", "2026-06-02 00:00:00"),
    ];
    recentDestinations(threads);
    expect(threads.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("cycleDestination", () => {
  it("cycles forward through new-chat + recents and wraps", () => {
    expect(cycleDestination(0, 2, 1)).toBe(1);
    expect(cycleDestination(1, 2, 1)).toBe(2);
    expect(cycleDestination(2, 2, 1)).toBe(0);
  });

  it("cycles backward and wraps to the last chip", () => {
    expect(cycleDestination(0, 2, -1)).toBe(2);
    expect(cycleDestination(2, 2, -1)).toBe(1);
  });

  it("stays on new chat when there are no recents", () => {
    expect(cycleDestination(0, 0, 1)).toBe(0);
    expect(cycleDestination(0, 0, -1)).toBe(0);
  });
});

describe("destinationThreadId", () => {
  const recents = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ];

  it("returns null for index 0 (new chat)", () => {
    expect(destinationThreadId(recents, 0)).toBeNull();
  });

  it("maps chip indices to thread ids", () => {
    expect(destinationThreadId(recents, 1)).toBe("a");
    expect(destinationThreadId(recents, 2)).toBe("b");
  });

  it("returns null for out-of-range indices (shrunk recents)", () => {
    expect(destinationThreadId(recents, 3)).toBeNull();
    expect(destinationThreadId([], 1)).toBeNull();
  });
});
