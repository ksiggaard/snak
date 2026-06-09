// T19: pure helpers for searching chat history. The actual DB query lives in
// `src/lib/db.ts` (`searchHistory`); everything here is runtime-free pure logic
// (query building, term extraction, snippet windowing, highlight segmentation)
// so it can be unit-tested without the Tauri/SQLite runtime.

import type { SearchHit, ThreadSearchGroup } from "@/types/db";

/**
 * Split a user's raw query into bare search terms (used both for the LIKE
 * fallback and for client-side highlighting). Punctuation is dropped; terms are
 * lower-cased and de-duplicated. Returns [] for an empty/whitespace query.
 */
export function searchTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

/**
 * Build a safe FTS5 MATCH expression from a user query. Each term is wrapped in
 * double quotes (FTS5 string literals) — with embedded `"` doubled — so user
 * input can never be interpreted as FTS5 syntax (column filters, NEAR, etc.).
 * A trailing `*` on each token makes it a prefix match ("hel" matches "hello"),
 * which suits incremental/as-you-type search. Terms are AND-ed (all must match).
 * Returns "" when there are no usable terms (caller should skip the query).
 */
export function buildFtsMatch(query: string): string {
  const terms = searchTerms(query);
  if (terms.length === 0) return "";
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" AND ");
}

/**
 * Group flat search hits by thread, preserving the input order (which the DB
 * returns best-match-first). Within a thread the first-seen hit order is kept;
 * a title hit is surfaced first so the group reads naturally.
 */
export function groupHitsByThread(hits: SearchHit[]): ThreadSearchGroup[] {
  const byThread = new Map<string, ThreadSearchGroup>();
  for (const hit of hits) {
    let group = byThread.get(hit.thread_id);
    if (!group) {
      group = {
        thread_id: hit.thread_id,
        thread_title: hit.thread_title,
        hits: [],
      };
      byThread.set(hit.thread_id, group);
    }
    group.hits.push(hit);
  }
  for (const group of byThread.values()) {
    group.hits.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "title" ? -1 : 1;
      return a.score - b.score;
    });
  }
  return [...byThread.values()];
}

/**
 * Extract a snippet around the first matching term, with a little context on
 * either side. Collapses whitespace, clamps to ~`window` chars centred on the
 * earliest match, and adds ellipses where text was trimmed. If no term matches
 * (e.g. a stemmed FTS hit like "running" for query "run"), returns the head of
 * the text so the UI still shows something.
 */
export function buildSnippet(text: string, query: string, window = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= window) return clean;

  const terms = searchTerms(query);
  const lower = clean.toLowerCase();
  let matchAt = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (matchAt === -1 || idx < matchAt)) matchAt = idx;
  }
  if (matchAt === -1) {
    return clean.slice(0, window).trimEnd() + "…";
  }

  const half = Math.floor(window / 2);
  let start = Math.max(0, matchAt - half);
  const end = Math.min(clean.length, start + window);
  start = Math.max(0, end - window);

  let snippet = clean.slice(start, end).trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < clean.length) snippet = snippet + "…";
  return snippet;
}

/** A run of snippet text, flagged whether it matched a search term. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split text into alternating non-match / match segments for rendering with
 * highlighted terms. Case-insensitive, matches any of the query's terms. Used by
 * the results view to wrap matched runs in a <mark>. Pure (no DOM) so it's
 * testable; the empty-terms case returns the whole text as a single non-match.
 */
export function highlightSegments(
  text: string,
  query: string,
): HighlightSegment[] {
  const terms = searchTerms(query);
  if (terms.length === 0 || !text) return [{ text, match: false }];

  // Longest-first so "foobar" wins over "foo" at the same position.
  const escaped = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "giu");

  const segments: HighlightSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ text: text.slice(last, idx), match: false });
    segments.push({ text: m[0], match: true });
    last = idx + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}
