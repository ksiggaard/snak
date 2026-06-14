/**
 * Quick actions: configurable one-tap starters shown on the empty new-chat
 * screen (e.g. "Proof read text", "Summarize article"). Each action carries a
 * prompt template and a click `mode`:
 *
 * - `prefill` — drop the prompt into the composer and focus it, so the user
 *   adds their own text (a pasted article, a draft message) before sending.
 * - `send` — fire the prompt as a message immediately.
 *
 * Actions live globally (a `settings` row, JSON) and a project may override the
 * global set with its own (the project's `quick_actions` JSON column). These
 * pure helpers are shared by the settings/project editors and the empty screen.
 */

export type QuickActionMode = "prefill" | "send";

export interface QuickAction {
  /** Stable id (crypto.randomUUID), used as the React key and for edits. */
  id: string;
  /** Chip text, e.g. "Proof read text". */
  label: string;
  /** Prompt template inserted into / sent as the message. */
  prompt: string;
  /** What clicking the chip does. */
  mode: QuickActionMode;
}

/** Seeded set for a fresh install (and the "Reset to defaults" button). The
 * three the user asked for. Ids are stable so a round-trip is deterministic in
 * tests; new actions added via the editor get a fresh uuid. */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  {
    id: "default-proofread",
    label: "Proof read text",
    prompt:
      "Proofread the following text and fix grammar, spelling, and punctuation. Keep my voice and meaning; show the corrected version, then a short list of what changed.\n\n",
    mode: "prefill",
  },
  {
    id: "default-feedback",
    label: "Give me feedback on a message",
    prompt:
      "Give me honest, constructive feedback on the message below — clarity, tone, and whether it lands. Suggest concrete improvements.\n\n",
    mode: "prefill",
  },
  {
    id: "default-summarize",
    label: "Summarize an article",
    prompt:
      "Summarize the following article in a few concise bullet points, then one sentence on the key takeaway.\n\n",
    mode: "prefill",
  },
];

function isMode(v: unknown): v is QuickActionMode {
  return v === "prefill" || v === "send";
}

/**
 * Parse a stored quick-actions JSON string into a clean list. Tolerant: returns
 * `[]` for null/empty/malformed input, drops entries that aren't well-formed,
 * and coerces a missing/invalid `mode` to `"prefill"`. An action with a blank
 * label *and* blank prompt is dropped (nothing to show).
 */
export function parseQuickActions(json: string | null | undefined): QuickAction[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: QuickAction[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const label = typeof e.label === "string" ? e.label : "";
    const prompt = typeof e.prompt === "string" ? e.prompt : "";
    if (!label.trim() && !prompt.trim()) continue;
    out.push({
      id: typeof e.id === "string" && e.id ? e.id : crypto.randomUUID(),
      label,
      prompt,
      mode: isMode(e.mode) ? e.mode : "prefill",
    });
  }
  return out;
}

/** Serialize a quick-actions list for storage. */
export function serializeQuickActions(actions: QuickAction[]): string {
  return JSON.stringify(actions);
}

/**
 * Resolve the quick actions that apply to a chat: a project's own set, when it
 * defines a non-empty one, replaces the global list; otherwise the global list
 * applies. `projectJson` is the project's stored `quick_actions` column (null
 * for a project-less chat or a project that defines none).
 */
export function resolveQuickActions(
  global: QuickAction[],
  projectJson: string | null | undefined,
): QuickAction[] {
  const projectActions = parseQuickActions(projectJson);
  return projectActions.length > 0 ? projectActions : global;
}
