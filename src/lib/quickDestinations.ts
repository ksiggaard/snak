// T31 — quick-input overlay destination picking. Pure helpers (unit-tested):
// the overlay shows "New chat" plus up to MAX_RECENTS recent threads in a
// dropdown, and Tab / Ctrl+Arrow cycles the selection without leaving the textarea.
//
// Recents delivery (the overlay never touches the DB): when Rust `show_quick`
// runs it emits QUICK_RECENTS_REQUEST_EVENT to the `main` window; App answers
// by emitting QUICK_RECENTS_EVENT to the `quick` window with the list below,
// taken from the in-memory threads store.

/** A destination option for an existing thread. */
export interface QuickRecent {
  id: string;
  title: string;
}

/** Max number of recent-thread chips shown in the overlay. */
export const MAX_RECENTS = 5;

/** Rust `show_quick` → main window: "send me the recent threads". */
export const QUICK_RECENTS_REQUEST_EVENT = "quick-recents-request";
/** Main window → quick window: the `QuickRecent[]` answer. */
export const QUICK_RECENTS_EVENT = "quick-recents";

/**
 * The `max` most recently updated threads as `{id, title}` chips. Sorts a copy
 * by `updated_at` descending (SQLite "YYYY-MM-DD HH:MM:SS" strings compare
 * lexically), so it doesn't depend on the input already being ordered.
 */
export function recentDestinations(
  threads: ReadonlyArray<{ id: string; title: string; updated_at: string }>,
  max: number = MAX_RECENTS,
): QuickRecent[] {
  return [...threads]
    .sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
    )
    .slice(0, Math.max(0, max))
    .map((t) => ({ id: t.id, title: t.title }));
}

/**
 * Cycle the selected destination index. Index 0 is "New chat"; 1..recentCount
 * are the recent-thread chips. Wraps in both directions; with 0 recents it
 * always stays on 0.
 */
export function cycleDestination(
  index: number,
  recentCount: number,
  dir: 1 | -1,
): number {
  const total = recentCount + 1;
  return (((index + dir) % total) + total) % total;
}

/**
 * The thread id a destination index points at, or null for "New chat" (or an
 * out-of-range index, e.g. after the recents list shrank).
 */
export function destinationThreadId(
  recents: ReadonlyArray<QuickRecent>,
  index: number,
): string | null {
  return index > 0 && index <= recents.length ? recents[index - 1].id : null;
}
