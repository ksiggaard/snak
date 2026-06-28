// Hashtags — nudge the model toward a tool/capability. Pure parsing/resolution
// (no React, no DB), a direct sibling of `mentions.ts`. Typing `#` in the
// composer opens an autocomplete palette of the hashtags available *right now* —
// every enabled MCP tool plus every enabled renderer language. Picking one turns
// it into a composer pill (the `#tag` text is removed); on send the picked/typed
// hashtags become a directive appended invisibly to the user's turn that strongly
// nudges the model to use that tool / output format. Unrecognized `#text` is left
// alone, so casual hashtags still send as plain text.
//
// Anchoring/boundary rules mirror `mentions.ts` (`@` → `#`): a `#` counts only at
// the start or after whitespace (so `C#`, `issue#42` never match), and a markdown
// `# heading` (a space right after `#`) never opens the palette.

import type { McpListedTool } from "@/lib/mcp";

export interface Hashtag {
  /** Token without the leading `#`, lowercased — what the palette filters on and
   *  what is matched in sent text (e.g. `search_web`, `artifact`, `vega-lite`). */
  tag: string;
  kind: "tool" | "renderer";
  /** What the directive points the model at: a namespaced tool id
   *  (`web__search_web`) for tools, or the renderer language for renderers. */
  target: string;
  /** Display label in the palette (the bare tool name / language). */
  label: string;
  description: string;
}

/** The `#token` being typed at the caret, for the palette. Mirrors `MentionQuery`. */
export interface HashtagQuery {
  /** Index of the `#`. */
  start: number;
  /** End of the contiguous token containing the caret (exclusive). */
  end: number;
  /** Text between the `#` and the caret — what the palette filters on. */
  query: string;
}

/** Renderer-language → directive phrasing (also used as the palette description).
 *  Unlisted languages fall back to a generic fenced-block line. */
const RENDERER_PHRASES: Record<string, string> = {
  artifact:
    "Respond with an interactive web app inside an `artifact` fenced code block.",
  map: "Respond with a `map` fenced code block (GeoJSON) so it renders as an interactive map.",
  mermaid:
    "Respond with a `mermaid` fenced code block so it renders as a diagram.",
  "vega-lite":
    "Respond with a `vega-lite` fenced code block so it renders as a chart.",
};

function rendererPhrase(lang: string): string {
  return (
    RENDERER_PHRASES[lang] ?? `Respond using a fenced \`${lang}\` code block.`
  );
}

/** Characters that can appear inside a hashtag token (so `#map.` matches `map`,
 *  and `#vega-lite` / `#search_web` keep their `-`/`_`). */
const TAG_CHAR = /[A-Za-z0-9_-]/;

/**
 * The hashtag token under the caret, or `null` when the caret isn't inside one.
 * A token starts at a `#` at position 0 or after whitespace, with only
 * non-whitespace between it and the caret; `end` extends past the caret to the
 * next whitespace so picking mid-token replaces the whole token.
 */
export function activeHashtagQuery(
  text: string,
  caret: number,
): HashtagQuery | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)#(\S*)$/.exec(before);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { start, end, query: match[1] };
}

/**
 * Hashtags whose tag starts with the typed query (case-insensitive); an empty
 * query lists all. Sorted by tag for a stable palette.
 */
export function matchHashtags(query: string, hashtags: Hashtag[]): Hashtag[] {
  const q = query.toLowerCase();
  return hashtags
    .filter((h) => h.tag.startsWith(q))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * The hashtag universe for the palette: one entry per enabled MCP tool plus one
 * per enabled renderer language. Deduped by tag.
 */
export function buildHashtags(
  tools: McpListedTool[],
  rendererLangs: string[],
): Hashtag[] {
  const byTag = new Map<string, Hashtag>();
  // ponytail: first-wins on short-name collisions; built-in tool names are
  // unique and external-server clashes are rare — disambiguate by server only if
  // it ever bites.
  for (const tool of tools) {
    const tag = tool.name.toLowerCase();
    if (!tag || byTag.has(tag)) continue;
    byTag.set(tag, {
      tag,
      kind: "tool",
      target: `${tool.server_id}__${tool.name}`,
      label: tool.name,
      description: tool.description,
    });
  }
  for (const raw of rendererLangs) {
    const tag = raw.toLowerCase();
    if (!tag || byTag.has(tag)) continue;
    byTag.set(tag, {
      tag,
      kind: "renderer",
      target: tag,
      label: tag,
      description: rendererPhrase(tag),
    });
  }
  return Array.from(byTag.values()).sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * The recognized hashtags mentioned anywhere in a sent message (deduped, in
 * first-mention order) plus the message text with *only those* tokens removed.
 * A `#token` matches when `#` is at the start or after whitespace and the token
 * (chars `[A-Za-z0-9_-]`) is exactly a known tag — so `C#`, `issue#42` and
 * unknown `#foo` are left untouched and send as plain text.
 */
export function extractHashtags(
  text: string,
  hashtags: Hashtag[],
): { found: Hashtag[]; cleaned: string } {
  const byTag = new Map(hashtags.map((h) => [h.tag, h] as const));
  const found: Hashtag[] = [];
  const seen = new Set<string>();
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const anchored = ch === "#" && (i === 0 || /\s/.test(text[i - 1]));
    if (!anchored) {
      out += ch;
      i++;
      continue;
    }
    let j = i + 1;
    while (j < text.length && TAG_CHAR.test(text[j])) j++;
    const token = text.slice(i + 1, j).toLowerCase();
    const hit = token ? byTag.get(token) : undefined;
    if (hit) {
      if (!seen.has(hit.tag)) {
        seen.add(hit.tag);
        found.push(hit);
      }
      // Drop the `#token`; swallow one trailing space so we don't leave a gap.
      i = j;
      if (text[i] === " ") i++;
    } else {
      out += ch;
      i++;
    }
  }
  // Collapse any horizontal-space runs left by removal, then trim the ends.
  const cleaned = found.length === 0 ? text : out.replace(/ {2,}/g, " ").trim();
  return { found, cleaned };
}

/**
 * The directive appended (invisibly) to the user's turn for the recognized
 * hashtags — the "convert into something we understand" step. Empty array →
 * `""` (a no-op the caller treats as "no directive").
 */
export function buildHashtagDirective(found: Hashtag[]): string {
  if (found.length === 0) return "";
  const lines = found.map((h) =>
    h.kind === "tool"
      ? `- Use the \`${h.target}\` tool to fulfil this request.`
      : `- ${rendererPhrase(h.tag)}`,
  );
  return `The user explicitly requested the following — you MUST honour it:\n${lines.join("\n")}`;
}
