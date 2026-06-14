// T54 response variations — pure logic for (a) collapsing a thread's message
// rows into one display slot per variant group (showing only the selected
// variant, while exposing every sibling id for browsing) and (b) steering a
// regeneration with an optional free-text direction. Kept dependency-free so it
// is unit-testable; the DB/stream wiring lives in lib/messages + store/threads.

/** The minimal row shape the grouping needs (Message satisfies it). */
export interface VariantRow {
  id: string;
  variant_group: string | null;
  variant_selected: number;
}

/** One display slot: the row to render plus, when grouped, every sibling
 * variant id in generation order (so the UI can show "‹ 2/3 ›" + navigate). */
export interface VariantSlot<T extends VariantRow> {
  /** The row to render at this slot — the group's *selected* variant. */
  emit: T;
  /** All sibling variant ids (oldest→newest), incl. `emit`; null when the row
   * is ungrouped (legacy/synthetic rows have no variation controls). */
  variantIds: string[] | null;
}

/**
 * Collapse an ordered message list into display slots: ungrouped rows pass
 * through 1:1; a variant group contributes a single slot — its *selected*
 * variant — positioned where the group's first (anchor) variant sits, so
 * switching the selection never moves the slot. Order is otherwise preserved.
 */
export function planVariants<T extends VariantRow>(rows: readonly T[]): VariantSlot<T>[] {
  // Group rows by variant_group (in input/generation order).
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (r.variant_group == null) continue;
    const g = groups.get(r.variant_group);
    if (g) g.push(r);
    else groups.set(r.variant_group, [r]);
  }
  // Whether a group has its anchor present (a row whose id === group id).
  const hasAnchor = new Map<string, boolean>();
  for (const [gid, members] of groups) {
    hasAnchor.set(gid, members.some((m) => m.id === gid));
  }

  const out: VariantSlot<T>[] = [];
  const emitted = new Set<string>();
  for (const r of rows) {
    const gid = r.variant_group;
    if (gid == null) {
      out.push({ emit: r, variantIds: null });
      continue;
    }
    if (emitted.has(gid)) continue; // a sibling already rendered this slot
    // Render the group at its anchor; if the anchor is somehow absent, render
    // at the first sibling encountered (defensive — backfill guarantees one).
    if (r.id !== gid && hasAnchor.get(gid)) continue;
    const members = groups.get(gid)!;
    const selected = members.find((m) => m.variant_selected === 1) ?? members[0];
    out.push({ emit: selected, variantIds: members.map((m) => m.id) });
    emitted.add(gid);
  }
  return out;
}

/** The instruction appended when regenerating, with an optional direction. */
export function regenSteer(direction: string): string {
  const base =
    "Please answer the previous request again with a different variation — " +
    "vary the wording, structure, or approach.";
  const dir = direction.trim();
  return dir ? `${base} Apply this direction: ${dir}.` : base;
}

/** A message shape the steer can mutate (ApiMessage satisfies it). */
interface Steerable {
  role: string;
  content: string;
}

/**
 * Apply the regenerate steer to an assembled API history: append the steer
 * (in a bracketed note) to the final user turn so the call ends on a single
 * user message — valid for every provider. If the history has no trailing user
 * turn (unexpected), append one carrying the steer.
 */
export function applyRegenSteer<T extends Steerable>(
  history: readonly T[],
  direction: string,
  makeUser: (content: string) => T,
): T[] {
  const note = `\n\n[${regenSteer(direction)}]`;
  const out = history.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      out[i] = { ...out[i], content: out[i].content + note };
      return out;
    }
  }
  out.push(makeUser(regenSteer(direction)));
  return out;
}
