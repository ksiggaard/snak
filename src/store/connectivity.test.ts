import { describe, expect, it } from "vitest";
import { deriveOffline } from "@/store/connectivity";

describe("deriveOffline", () => {
  it("is offline when auto-detection reports offline", () => {
    expect(deriveOffline("offline", false)).toBe(true);
  });

  it("is online when auto-detection reports online", () => {
    expect(deriveOffline("online", false)).toBe(false);
  });

  it("treats the initial 'checking' state as online (never blocks first paint/send)", () => {
    expect(deriveOffline("checking", false)).toBe(false);
    expect(deriveOffline("checking", null)).toBe(false);
  });

  it("treats a not-yet-loaded override (null) as not forced", () => {
    expect(deriveOffline("online", null)).toBe(false);
  });

  it("manual 'Work offline' override forces offline even on a working connection", () => {
    expect(deriveOffline("online", true)).toBe(true);
    expect(deriveOffline("checking", true)).toBe(true);
  });
});
