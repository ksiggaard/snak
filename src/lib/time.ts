// Time formatting for chat reply metadata. `created_at` comes from SQLite as a
// UTC "YYYY-MM-DD HH:MM:SS" string with no timezone marker (see src/lib/db.ts),
// so it must be parsed as UTC — naive `new Date(s)` would treat it as local
// time and be off by the local offset.

/** Parse a SQLite "YYYY-MM-DD HH:MM:SS" UTC timestamp into a Date. Input is
 * assumed well-formed (it always comes from a DB row, never user input). */
export function parseDbTime(s: string): Date {
  return new Date(`${s.replace(" ", "T")}Z`);
}

/** Human-readable "… ago" label; absolute date once older than 7 days. */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const sec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  return date.toLocaleDateString();
}

/** Format a duration in ms: "4.2s" under a minute, "1m 23s" at/above. */
export function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.min(59.9, ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}
