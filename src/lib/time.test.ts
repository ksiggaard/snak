import { describe, it, expect } from "vitest";
import {
  formatClock,
  formatDuration,
  formatThreadDate,
  parseDbTime,
  relativeTime,
} from "@/lib/time";

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

describe("formatClock", () => {
  it("is M:SS under a minute", () => {
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(0)).toBe("0:00");
  });
  it("is M:SS / MM:SS under an hour", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(630_000)).toBe("10:30");
  });
  it("is H:MM:SS at an hour and above", () => {
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
  it("clamps negatives to 0:00", () => {
    expect(formatClock(-1)).toBe("0:00");
  });
});

describe("formatThreadDate", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("is relative under 7 days", () => {
    expect(formatThreadDate("2026-06-12 10:00:00", now)).toBe("2h ago");
    expect(formatThreadDate("2026-06-09 12:00:00", now)).toBe("3d ago");
    expect(formatThreadDate("2026-06-12 11:59:50", now)).toBe("just now");
  });

  it("is an Intl-formatted absolute date (no year) at/beyond 7 days", () => {
    const out = formatThreadDate("2026-04-02 12:00:00", now);
    expect(out).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(parseDbTime("2026-04-02 12:00:00")),
    );
    expect(out).not.toMatch(/ago/);
  });

  it("includes the year when it differs from now's", () => {
    const out = formatThreadDate("2025-12-30 12:00:00", now);
    expect(out).toContain("2025");
  });

  it("switches exactly at the 7-day boundary", () => {
    // 7 days minus a second: still relative.
    expect(formatThreadDate("2026-06-05 12:00:01", now)).toBe("6d ago");
    // Exactly 7 days: absolute.
    expect(formatThreadDate("2026-06-05 12:00:00", now)).not.toMatch(/ago/);
  });
});
