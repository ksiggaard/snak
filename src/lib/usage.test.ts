import { describe, it, expect } from "vitest";
import {
  buildHeatmap,
  dayKeyToDate,
  formatTokens,
  heatLevel,
  toLocalDayKey,
} from "@/lib/usage";
import type { DailyUsage } from "@/lib/db";

describe("toLocalDayKey / dayKeyToDate round-trip", () => {
  it("formats a date as zero-padded YYYY-MM-DD", () => {
    expect(toLocalDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toLocalDayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("round-trips through dayKeyToDate at local midnight", () => {
    const d = dayKeyToDate("2026-06-09");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June (0-indexed)
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(0);
  });
});

describe("heatLevel", () => {
  it("is 0 for no activity or zero max", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(50, 0)).toBe(0);
  });

  it("quantizes the fraction of max into 4 buckets", () => {
    expect(heatLevel(10, 100)).toBe(1); // 0.10
    expect(heatLevel(25, 100)).toBe(1); // 0.25 boundary -> still level 1
    expect(heatLevel(40, 100)).toBe(2); // 0.40
    expect(heatLevel(60, 100)).toBe(3); // 0.60
    expect(heatLevel(100, 100)).toBe(4); // 1.00
  });
});

describe("formatTokens", () => {
  it("leaves sub-thousands as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });
  it("uses K for thousands", () => {
    expect(formatTokens(1234)).toBe("1.2K");
    expect(formatTokens(15_000)).toBe("15K");
  });
  it("uses M for millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(12_000_000)).toBe("12M");
  });
});

describe("buildHeatmap", () => {
  const end = new Date(2026, 5, 9); // Tue 2026-06-09

  it("produces 7-tall week columns and quantizes levels", () => {
    const daily: DailyUsage[] = [
      { day: "2026-06-09", total_tokens: 1000, responses: 4 },
      { day: "2026-06-08", total_tokens: 250, responses: 1 },
      { day: "2026-06-01", total_tokens: 500, responses: 2 },
    ];
    const { weeks, max } = buildHeatmap(daily, 14, end);

    expect(max).toBe(1000);
    // Every column is exactly 7 cells tall.
    for (const w of weeks) expect(w).toHaveLength(7);

    // Flatten and find the cells we seeded.
    const cells = weeks.flat().filter((c) => c !== null);
    const busiest = cells.find((c) => c!.day === "2026-06-09")!;
    expect(busiest.level).toBe(4); // 1000/1000
    const mid = cells.find((c) => c!.day === "2026-06-08")!;
    expect(mid.level).toBe(1); // 250/1000 = 0.25
    const half = cells.find((c) => c!.day === "2026-06-01")!;
    expect(half.level).toBe(2); // 500/1000 = 0.50 -> >0.25
  });

  it("only includes days within the window", () => {
    const daily: DailyUsage[] = [
      { day: "2026-06-09", total_tokens: 100, responses: 1 },
      // Outside a 7-day window ending 2026-06-09:
      { day: "2026-05-01", total_tokens: 9999, responses: 9 },
    ];
    const { weeks, max } = buildHeatmap(daily, 7, end);
    const days = weeks
      .flat()
      .filter((c) => c !== null)
      .map((c) => c!.day);
    expect(days).toContain("2026-06-09");
    expect(days).not.toContain("2026-05-01");
    // The out-of-window busy day must not inflate the scale.
    expect(max).toBe(100);
  });

  it("aligns columns to Sunday (first column's first non-null is the window start day-of-week)", () => {
    // 2026-06-09 is a Tuesday; a 1-day window starts and ends Tuesday.
    const { weeks } = buildHeatmap(
      [{ day: "2026-06-09", total_tokens: 10, responses: 1 }],
      1,
      end,
    );
    // Single week column: Sun..Sat with only the Tuesday (index 2) populated.
    expect(weeks).toHaveLength(1);
    expect(weeks[0][0]).toBeNull(); // Sun
    expect(weeks[0][1]).toBeNull(); // Mon
    expect(weeks[0][2]?.day).toBe("2026-06-09"); // Tue
    expect(weeks[0][3]).toBeNull(); // Wed (today is Tue, beyond end)
  });
});
