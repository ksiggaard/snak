import { describe, it, expect } from "vitest";
import { formatDuration, parseDbTime, relativeTime } from "@/lib/time";

describe("parseDbTime", () => {
  it("parses a SQLite UTC string as UTC, not local time", () => {
    // No timezone marker in the DB string; must be treated as UTC.
    expect(parseDbTime("2026-06-10 14:32:05").toISOString()).toBe(
      "2026-06-10T14:32:05.000Z",
    );
  });
});

describe("relativeTime", () => {
  const base = new Date("2026-06-10T12:00:00Z");
  const ago = (ms: number) => relativeTime(new Date(base.getTime() - ms), base);

  it("says 'just now' under 45s", () => {
    expect(ago(10_000)).toBe("just now");
  });
  it("rounds the 45-60s gap up to 1m", () => {
    expect(ago(50_000)).toBe("1m ago");
  });
  it("formats minutes", () => {
    expect(ago(5 * 60_000)).toBe("5m ago");
  });
  it("formats hours", () => {
    expect(ago(2 * 3_600_000)).toBe("2h ago");
  });
  it("formats days", () => {
    expect(ago(3 * 86_400_000)).toBe("3d ago");
  });
  it("falls back to an absolute date past 7 days", () => {
    const old = new Date(base.getTime() - 10 * 86_400_000);
    expect(relativeTime(old, base)).toBe(old.toLocaleDateString());
  });
  it("treats future timestamps as 'just now' (clock skew)", () => {
    expect(relativeTime(new Date(base.getTime() + 5_000), base)).toBe(
      "just now",
    );
  });
});

describe("formatDuration", () => {
  it("uses one-decimal seconds under a minute", () => {
    expect(formatDuration(4200)).toBe("4.2s");
    expect(formatDuration(500)).toBe("0.5s");
  });
  it("uses Nm Ss at a minute and above", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(83_000)).toBe("1m 23s");
  });
  it("clamps the sub-minute branch so it never rounds up to 60.0s", () => {
    expect(formatDuration(59_990)).toBe("59.9s");
    expect(formatDuration(59_500)).toBe("59.5s");
  });
});
