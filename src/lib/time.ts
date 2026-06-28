// Time formatting for chat reply metadata. `created_at` comes from SQLite as a
// UTC "YYYY-MM-DD HH:MM:SS" string with no timezone marker (see src/lib/db.ts),
// so it must be parsed as UTC — naive `new Date(s)` would treat it as local
// time and be off by the local offset.
//
// i18n (T32): these helpers stay **pure** — the active locale/labels are
// parameters with English defaults (existing callers/tests unchanged).
// Components pass `timeLabels()` / `useIntlLocale()` from `@/store/i18n`.

/** Parse a SQLite "YYYY-MM-DD HH:MM:SS" UTC timestamp into a Date. Input is
 * assumed well-formed (it always comes from a DB row, never user input). */
export function parseDbTime(s: string): Date {
  return new Date(`${s.replace(" ", "T")}Z`);
}

/** Relative-time label templates; `{n}` is replaced with the count. */
export interface RelativeTimeLabels {
  justNow: string;
  minutes: string;
  hours: string;
  days: string;
}

const EN_LABELS: RelativeTimeLabels = {
  justNow: "just now",
  minutes: "{n}m ago",
  hours: "{n}h ago",
  days: "{n}d ago",
};

const fill = (template: string, n: number) =>
  template.replace("{n}", String(n));

/** Human-readable "… ago" label; absolute date once older than 7 days. */
export function relativeTime(
  date: Date,
  now: Date = new Date(),
  labels: RelativeTimeLabels = EN_LABELS,
  locale?: string,
): string {
  const sec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (sec < 45) return labels.justNow;
  if (sec < 3600)
    return fill(labels.minutes, Math.max(1, Math.floor(sec / 60)));
  if (sec < 86400) return fill(labels.hours, Math.floor(sec / 3600));
  if (sec < 7 * 86400) return fill(labels.days, Math.floor(sec / 86400));
  return date.toLocaleDateString(locale);
}

/**
 * Sidebar thread-row date (T35): relative ("2h ago") under 7 days, otherwise an
 * `Intl`-formatted absolute date ("Apr 2", with the year when it differs from
 * `now`'s). Takes the raw SQLite `updated_at` string. `locale`/`labels` come
 * from the active language (defaults: system locale formatting, English
 * labels).
 */
export function formatThreadDate(
  updatedAt: string,
  now: Date = new Date(),
  opts?: { locale?: string; labels?: RelativeTimeLabels },
): string {
  const date = parseDbTime(updatedAt);
  if (now.getTime() - date.getTime() < 7 * 86_400_000)
    return relativeTime(date, now, opts?.labels, opts?.locale);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(opts?.locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** Format a duration in ms: "4.2s" under a minute, "1m 23s" at/above. */
export function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.min(59.9, ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}

/** Stopwatch clock: "M:SS" / "MM:SS" under an hour, "H:MM:SS" at/above. Used by
 * the live progress counter and the kept per-message duration (≥1 min). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}
