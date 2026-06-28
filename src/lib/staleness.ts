// Stale-stream watchdog (pure). A running step is left alone for its first
// STALE_AFTER_MS; past that we watch for activity and, once a full
// STALE_CHECK_MS window passes with none, call it stale so the caller can stop
// the stuck stream. Any token/event resets `lastActivityAt`, so a slow-but-live
// stream is never flagged — only one that has genuinely gone quiet.

/** A step runs unsupervised for this long before the watchdog starts checking. */
export const STALE_AFTER_MS = 100_000;
/** Once watching, this much continuous inactivity counts as stale. */
export const STALE_CHECK_MS = 15_000;

export interface StaleEval {
  /** Past the grace period — the watchdog is now scrutinising this step. */
  watching: boolean;
  /** No activity for a full check window → caller should stop the run. */
  stale: boolean;
  /** Seconds until the next stale check (for the reassurance countdown), or
   *  null when not yet watching. Clamped to >= 0. */
  nextCheckSec: number | null;
}

export function evaluateStale(
  now: number,
  stepStartedAt: number,
  lastActivityAt: number,
): StaleEval {
  const watching = now - stepStartedAt > STALE_AFTER_MS;
  if (!watching) return { watching: false, stale: false, nextCheckSec: null };
  const idleMs = now - lastActivityAt;
  return {
    watching: true,
    stale: idleMs >= STALE_CHECK_MS,
    nextCheckSec: Math.max(0, Math.ceil((STALE_CHECK_MS - idleMs) / 1000)),
  };
}
