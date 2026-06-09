// T16 usage view helpers: GitHub-style activity-heatmap date math + token
// formatting. Kept pure (no DOM, no DB) so the bucketing logic is unit-tested.

import type { DailyUsage } from "@/lib/db";

/** One cell in the heatmap grid. */
export interface HeatmapCell {
  /** Local "YYYY-MM-DD". */
  day: string;
  total_tokens: number;
  responses: number;
  /** 0 (no activity) … 4 (most), for the 5-step GitHub color scale. */
  level: 0 | 1 | 2 | 3 | 4;
}

/** A column in the heatmap = one week (Sunday-first), 7 cells tall. */
export type HeatmapWeek = (HeatmapCell | null)[];

/** Local "YYYY-MM-DD" for a Date (uses the machine's timezone). */
export function toLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a "YYYY-MM-DD" key into a local-midnight Date. */
export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Bucket a daily-usage list into a GitHub-style grid spanning `days` calendar
 * days ending at `end` (default: today). The grid is built as Sunday-first
 * weeks (columns), each 7 cells (Sun..Sat). Leading/trailing cells outside the
 * window are `null`. The color `level` is a 0–4 quantization of `total_tokens`
 * relative to the busiest day in the window.
 */
export function buildHeatmap(
  daily: DailyUsage[],
  days = 365,
  end: Date = new Date(),
): { weeks: HeatmapWeek[]; max: number } {
  const byDay = new Map<string, DailyUsage>();
  for (const d of daily) byDay.set(d.day, d);

  // Window start = `end` minus (days - 1), at local midnight.
  const endMid = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const start = new Date(endMid);
  start.setDate(start.getDate() - (days - 1));

  // Busiest day in the window sets the top of the color scale.
  let max = 0;
  for (let c = new Date(start); c <= endMid; c.setDate(c.getDate() + 1)) {
    const t = byDay.get(toLocalDayKey(c))?.total_tokens ?? 0;
    if (t > max) max = t;
  }

  // Pad the first column back to the preceding Sunday so weeks align by row.
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // getDay(): 0 = Sun

  const weeks: HeatmapWeek[] = [];
  let week: HeatmapWeek = [];
  for (let c = new Date(gridStart); c <= endMid; c.setDate(c.getDate() + 1)) {
    const inWindow = c >= start; // skip the leading Sunday padding
    if (!inWindow) {
      week.push(null);
    } else {
      const key = toLocalDayKey(c);
      const row = byDay.get(key);
      const total = row?.total_tokens ?? 0;
      week.push({
        day: key,
        total_tokens: total,
        responses: row?.responses ?? 0,
        level: heatLevel(total, max),
      });
    }
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  // Pad the final partial week with nulls so every column is 7 tall.
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return { weeks, max };
}

/** Quantize a token count to a 0–4 level relative to `max`. */
export function heatLevel(total: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0 || max <= 0) return 0;
  const frac = total / max;
  if (frac > 0.75) return 4;
  if (frac > 0.5) return 3;
  if (frac > 0.25) return 2;
  return 1;
}

/** Compact token count: 1234 → "1.2K", 1_500_000 → "1.5M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}
