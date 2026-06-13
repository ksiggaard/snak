// T43 @-mention support — pure parsing/resolution helpers (no React, no DB).
//
// Typing `@` in the composer opens an autocomplete palette of personas (T38
// bots); on send, each mentioned persona produces its own one-shot,
// in-character reply. This module owns the matching rules:
//
// - **Anchoring:** an `@` counts as a mention only at the start of the text or
//   after whitespace — `kasper@example.com` is never a mention.
// - **Palette queries don't span spaces** (`activeMentionQuery`): the active
//   token is the contiguous non-whitespace run between the `@` and the caret.
//   Multi-word persona names ("Jane Doe") match the palette by first-word
//   prefix and are completed by picking; `insertMention` appends a trailing
//   space, which by the same rule closes the palette deterministically.
// - **Send-time extraction spans spaces** (`extractMentions`): at each anchor
//   the *longest* persona name that case-insensitively prefixes the following
//   text wins (so "Jane Doe" beats "Jane"), with a non-alphanumeric boundary
//   required after the name (`@Bobby` does not match "Bob"; `@Bob,` does).
//   Plain string comparison only — persona names never become RegExps.
// - Non-resolving `@…` text is left alone and sends as plain content.

/** The id+name slice of a `Bot` these helpers need (tests stay lightweight). */
export interface MentionCandidate {
  id: string;
  name: string;
}

/** The `@token` being typed at the caret, for the palette. */
export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number;
  /** End of the contiguous token containing the caret (exclusive). */
  end: number;
  /** Text between the `@` and the caret — what the palette filters on. */
  query: string;
}

/**
 * The mention token under the caret, or `null` when the caret isn't inside
 * one. A token starts at an `@` that sits at position 0 or after whitespace,
 * with only non-whitespace between it and the caret. `end` extends past the
 * caret to the next whitespace so picking mid-token replaces the whole token.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): MentionQuery | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@(\S*)$/.exec(before);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { start, end, query: match[1] };
}

/**
 * Personas whose name starts with the typed query (case-insensitive); an
 * empty query lists all. Blank-named personas are skipped (nothing to type).
 * Sorted by name for a stable palette.
 */
export function matchMentionBots<T extends MentionCandidate>(
  query: string,
  bots: T[],
): T[] {
  const q = query.toLowerCase();
  return bots
    .filter((b) => {
      const name = b.name.trim();
      return name !== "" && name.toLowerCase().startsWith(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the character can extend a word — i.e. it is NOT a valid
 * boundary after a matched persona name. Unicode-aware (letters + digits). */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * The personas mentioned anywhere in a sent message, in first-mention order,
 * deduped by id. See the module header for the anchoring / longest-name-wins
 * / boundary rules.
 */
export function extractMentions<T extends MentionCandidate>(
  text: string,
  bots: T[],
): T[] {
  const candidates = bots.filter((b) => b.name.trim() !== "");
  if (candidates.length === 0) return [];
  const lower = text.toLowerCase();
  const found: T[] = [];
  const seen = new Set<string>();

  let i = 0;
  while (i < lower.length) {
    const at = lower.indexOf("@", i);
    if (at === -1) break;
    // Anchor rule: start of text or preceded by whitespace.
    if (at > 0 && !/\s/.test(text[at - 1])) {
      i = at + 1;
      continue;
    }
    const after = lower.slice(at + 1);
    let best: T | null = null;
    for (const bot of candidates) {
      const name = bot.name.trim().toLowerCase();
      if (!after.startsWith(name)) continue;
      // Boundary rule: the name must not run into more word characters.
      if (isWordChar(text[at + 1 + name.length])) continue;
      if (!best || name.length > best.name.trim().length) best = bot;
    }
    if (best) {
      if (!seen.has(best.id)) {
        seen.add(best.id);
        found.push(best);
      }
      i = at + 1 + best.name.trim().length;
    } else {
      i = at + 1;
    }
  }
  return found;
}

/**
 * Replace the active `@token` with `@Name ` (trailing space — which also
 * closes the palette, per `activeMentionQuery`'s no-whitespace rule). Returns
 * the new text and where the caret should land.
 */
export function insertMention(
  text: string,
  q: MentionQuery,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  return {
    text: text.slice(0, q.start) + inserted + text.slice(q.end),
    caret: q.start + inserted.length,
  };
}
