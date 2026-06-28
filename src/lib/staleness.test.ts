import { describe, it, expect } from "vitest";
import {
  evaluateStale,
  STALE_AFTER_MS,
  STALE_CHECK_MS,
} from "@/lib/staleness";

describe("evaluateStale", () => {
  const start = 1_000_000;

  it("is not watching within the grace period", () => {
    const r = evaluateStale(start + STALE_AFTER_MS - 1, start, start);
    expect(r).toEqual({ watching: false, stale: false, nextCheckSec: null });
  });

  it("watches but is not stale when activity is recent", () => {
    const now = start + STALE_AFTER_MS + 5_000;
    const r = evaluateStale(now, start, now - 3_000); // idle 3s
    expect(r.watching).toBe(true);
    expect(r.stale).toBe(false);
    expect(r.nextCheckSec).toBe(12); // (15 - 3)s
  });

  it("is stale after a full window with no activity", () => {
    const now = start + STALE_AFTER_MS + 1;
    const r = evaluateStale(now, start, now - STALE_CHECK_MS);
    expect(r.stale).toBe(true);
    expect(r.nextCheckSec).toBe(0);
  });
});
