// T57 — rotating loading messages during the pre-first-token pending window.
//
// ## Design
// A small pool of friendly phrases cycles while the model is warming up.
// Each phrase is an i18n key so all bundled language packs carry a translation.
//
// The pure function `pickLoadingMessage` is the only testable seam: given the
// current tick index and the phrase pool, it returns the key to display. The
// DOM/timer wiring lives in the component that consumes it.

/** The ordered pool of i18n message keys shown while `pending` is true. */
export const LOADING_MESSAGE_KEYS = [
  "chat.loading.0",
  "chat.loading.1",
  "chat.loading.2",
  "chat.loading.3",
  "chat.loading.4",
  "chat.loading.5",
] as const;

export type LoadingMessageKey = (typeof LOADING_MESSAGE_KEYS)[number];

/**
 * Return the loading-message key for a given tick, cycling through the pool.
 *
 * @param tick   Non-negative integer representing how many intervals have
 *               elapsed since `pending` became true. Starts at 0.
 * @param pool   Ordered array of message keys to cycle through. Must be
 *               non-empty.
 */
export function pickLoadingMessage(
  tick: number,
  pool: readonly string[] = LOADING_MESSAGE_KEYS,
): string {
  if (pool.length === 0) return LOADING_MESSAGE_KEYS[0];
  return pool[tick % pool.length];
}
