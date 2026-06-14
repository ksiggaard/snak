/**
 * Stable, thread-persistent labels for images so the user and the model can
 * refer to a specific picture ("tell me about Image B") across the whole
 * conversation. Labels are **positional** — assigned by order of appearance in
 * the thread (message order, then left-to-right within a message) — so they
 * need no storage and never renumber earlier images when new ones are fetched.
 *
 * The same labels are shown on the thumbnails (so the user knows what to type)
 * and injected as a text manifest into the API history (so the model knows
 * which image each label denotes) — see `compactHistory`.
 */

/** Minimal shape these helpers need from a message. */
interface WithImages {
  images?: unknown[];
}

/**
 * Spreadsheet-style label for a zero-based image index: 0→"A", 25→"Z", 26→"AA",
 * 27→"AB", … Unbounded, so a long thread never runs out of labels.
 */
export function imageLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/**
 * Prefix sums of image counts: `offsets[k]` is how many images appear before
 * message `k`, so the i-th image of message `k` is labeled
 * `imageLabel(offsets[k] + i)`. Computing once and indexing keeps labeling O(n)
 * and consistent between the UI and the API-history assembly (both walk the
 * same ordered message list).
 */
export function imageLabelOffsets(messages: readonly WithImages[]): number[] {
  const offsets: number[] = [];
  let total = 0;
  for (const m of messages) {
    offsets.push(total);
    total += m.images?.length ?? 0;
  }
  return offsets;
}
