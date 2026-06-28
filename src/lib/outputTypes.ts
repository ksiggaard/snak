// Output types (response-style picker, composer toolbar).
//
// A per-thread choice that shapes HOW the model replies — terse, verbose, plain
// text, JSON, a table, etc. — by injecting one system instruction at send time.
// `default` injects nothing (the model's natural style). Persisted per thread
// (column `output_type`), mirroring the deep-research toggle.
//
// This module is pure (no React/DOM) so it unit-tests in isolation. The
// model-facing `systemText` strings live here, not in i18n, per the project's
// code-style rule (LLM prompts are exempt). Only the human-facing menu labels
// are i18n (`labelKey`).

import { hasRenderer, type HostRegistry } from "@/lib/plugins";
import { ARTIFACT_LANGUAGE } from "@/lib/artifacts";
import type { MessageKey } from "@/store/i18n";

export type OutputTypeId =
  | "default"
  | "flat"
  | "artefact"
  | "veryDetailed"
  | "detailed"
  | "json"
  | "short"
  | "veryShort"
  | "bullets"
  | "table"
  | "eli5";

export const DEFAULT_OUTPUT_TYPE: OutputTypeId = "default";

export interface OutputTypeDef {
  id: OutputTypeId;
  /** i18n key for the menu label. */
  labelKey: MessageKey;
  /** Instruction injected as a system block, or null for no block (default). */
  systemText: string | null;
  /** When set, the entry is only listed/active while an enabled `renderer`
   *  plugin contributes this language (e.g. the artifacts plugin). */
  requiresRenderer?: string;
}

/** The full catalogue in display order. */
export const OUTPUT_TYPES: OutputTypeDef[] = [
  { id: "default", labelKey: "outputType.default", systemText: null },
  {
    id: "flat",
    labelKey: "outputType.flat",
    systemText:
      "Respond in plain text only. Do not use any Markdown formatting — no " +
      "headings, bold, italics, bulleted or numbered lists, tables, blockquotes, " +
      "or code fences. Write in plain prose.",
  },
  {
    id: "artefact",
    labelKey: "outputType.artefact",
    requiresRenderer: ARTIFACT_LANGUAGE,
    systemText:
      "Deliver your answer as a single self-contained artifact: respond with one " +
      "fenced code block tagged `artifact` and nothing else before or after it. " +
      "Use the artifact format already described to you.",
  },
  {
    id: "veryDetailed",
    labelKey: "outputType.veryDetailed",
    systemText:
      "Be exhaustive and thorough. Cover the topic in depth with full " +
      "explanations, relevant background, edge cases, examples, and caveats. Do " +
      "not omit detail for the sake of brevity.",
  },
  {
    id: "detailed",
    labelKey: "outputType.detailed",
    systemText:
      "Give a detailed answer with clear explanations and supporting context, " +
      "while staying focused on what the user asked.",
  },
  {
    id: "json",
    labelKey: "outputType.json",
    systemText:
      "Respond with a single valid JSON value and nothing else. Do not include " +
      "any prose, explanation, or Markdown — output only the raw JSON.",
  },
  {
    id: "short",
    labelKey: "outputType.short",
    systemText:
      "Keep your answer short and to the point — a few sentences at most. Omit " +
      "preamble and unnecessary detail.",
  },
  {
    id: "veryShort",
    labelKey: "outputType.veryShort",
    systemText:
      "Answer in as few words as possible — ideally a single sentence or phrase. " +
      "No preamble, no elaboration.",
  },
  {
    id: "bullets",
    labelKey: "outputType.bullets",
    systemText:
      "Structure your entire answer as a bulleted list. Keep each bullet concise; " +
      "use nested bullets for sub-points rather than paragraphs.",
  },
  {
    id: "table",
    labelKey: "outputType.table",
    systemText:
      "Present your answer as a Markdown table wherever the content reasonably " +
      "fits a tabular form. Keep any surrounding prose minimal.",
  },
  {
    id: "eli5",
    labelKey: "outputType.eli5",
    systemText:
      "Explain in the simplest possible terms, as if to a curious beginner. Avoid " +
      "jargon; when a technical term is unavoidable, define it plainly. Use short " +
      "sentences and everyday analogies.",
  },
];

const BY_ID = new Map(OUTPUT_TYPES.map((o) => [o.id, o]));

/** Whether an output-type entry is currently available (its gating renderer, if
 *  any, is enabled). Entries with no `requiresRenderer` are always available. */
function isAvailable(def: OutputTypeDef, reg: HostRegistry): boolean {
  return !def.requiresRenderer || hasRenderer(reg, def.requiresRenderer);
}

/** The entries to list in the picker: built-ins plus any renderer-gated entry
 *  whose contributing plugin is enabled. */
export function availableOutputTypes(reg: HostRegistry): OutputTypeDef[] {
  return OUTPUT_TYPES.filter((o) => isAvailable(o, reg));
}

/** The system instruction for a selected output type, or "" when it should
 *  inject nothing — for `default`, an unknown id, or a renderer-gated entry
 *  whose plugin is no longer enabled (graceful no-op). */
export function buildOutputTypeSystemText(
  id: string,
  reg: HostRegistry,
): string {
  const def = BY_ID.get(id as OutputTypeId);
  if (!def || !def.systemText || !isAvailable(def, reg)) return "";
  return def.systemText;
}
