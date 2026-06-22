// Read-along highlighting for the audio plugin's read-aloud (TTS). When the
// "highlight while reading" option is on, the reply is spoken one sentence at a
// time (Piper gives no word timestamps, so sentence boundaries are the exact,
// drift-free unit — see the per-sentence sync choice) and the matching sentence
// is lit up *in place* inside the message bubble.
//
// The highlight is painted with the CSS Custom Highlight API (`CSS.highlights` +
// `Highlight` + `Range`), which colors arbitrary text ranges WITHOUT mutating
// the DOM — so react-markdown's output (formatting, links, code) is untouched and
// a re-render can't fight us. Where the API is unavailable the feature degrades
// to plain sentence-by-sentence playback with no visual highlight.

/** Registered highlight name; paired with the `::highlight(read-along)` rule in
 *  index.css. */
export const READ_ALONG_HIGHLIGHT = "read-along";

/** A text node and the half-open global char range it occupies in the collected
 *  prose (`[start, end)`), so a prose offset maps back to (node, node-offset). */
interface ProseNode {
  node: Text;
  start: number;
  end: number;
}

/** The visible prose under a message body plus the node map to rebuild ranges. */
export interface ProseMap {
  text: string;
  nodes: ProseNode[];
}

/** A sentence's trimmed text and its half-open char range within `ProseMap.text`. */
export interface SentenceRange {
  text: string;
  start: number;
  end: number;
}

/**
 * Walk the visible text under `root`, concatenating it into one prose string and
 * recording each text node's char range. Code is skipped (`<pre>`/`<code>`) — we
 * never read or highlight it — but all other text nodes (including whitespace)
 * are kept so offsets stay contiguous and map cleanly back to DOM ranges.
 */
export function collectProse(root: HTMLElement): ProseMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      if (el && el.closest("pre, code")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let text = "";
  const nodes: ProseNode[] = [];
  let n = walker.nextNode() as Text | null;
  while (n) {
    const content = n.textContent ?? "";
    nodes.push({ node: n, start: text.length, end: text.length + content.length });
    text += content;
    n = walker.nextNode() as Text | null;
  }
  return { text, nodes };
}

/**
 * Split prose into sentences, returning each sentence's trimmed text and the
 * tight char range (leading/trailing whitespace excluded) for highlighting.
 * Sentence end = `.`/`!`/`?` (incl. CJK forms) at a word boundary; a trailing
 * run with no terminator becomes a final sentence.
 */
export function splitSentenceRanges(text: string): SentenceRange[] {
  const out: SentenceRange[] = [];
  const re = /[.!?。！？]+(?=\s|$)/g;
  let segStart = 0;

  const push = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const start = from + leading;
    out.push({ text: trimmed, start, end: start + trimmed.length });
  };

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    push(segStart, end);
    segStart = end;
  }
  if (segStart < text.length) push(segStart, text.length);
  return out;
}

/** Build a DOM Range spanning the half-open prose range `[start, end)`. */
export function buildRange(map: ProseMap, start: number, end: number): Range | null {
  const startEntry =
    map.nodes.find((e) => start >= e.start && start < e.end) ??
    map.nodes.find((e) => start <= e.end);
  const endEntry =
    map.nodes.find((e) => end > e.start && end <= e.end) ??
    [...map.nodes].reverse().find((e) => end >= e.start);
  if (!startEntry || !endEntry) return null;

  try {
    const range = document.createRange();
    range.setStart(startEntry.node, Math.max(0, start - startEntry.start));
    range.setEnd(endEntry.node, Math.max(0, Math.min(end - endEntry.start, endEntry.end - endEntry.start)));
    return range;
  } catch {
    return null;
  }
}

// The CSS Custom Highlight API isn't in TS's DOM lib across all targets; narrow
// it locally rather than widen the global lib.
interface HighlightRegistry {
  set: (name: string, highlight: object) => void;
  delete: (name: string) => void;
}
type HighlightCtor = new (...ranges: Range[]) => object;

function highlights(): HighlightRegistry | null {
  const reg = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  return reg ?? null;
}

/** True when the host can paint custom highlights (else: audio plays, no glow). */
export function readAlongSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    highlights() !== null &&
    typeof (globalThis as { Highlight?: HighlightCtor }).Highlight === "function"
  );
}

/** Paint `range` as the read-along highlight (clears it when `range` is null). */
export function setReadAlongHighlight(range: Range | null): void {
  const reg = highlights();
  if (!reg) return;
  if (!range) {
    reg.delete(READ_ALONG_HIGHLIGHT);
    return;
  }
  const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!Ctor) return;
  reg.set(READ_ALONG_HIGHLIGHT, new Ctor(range));
}

/** Remove the read-along highlight if one is set. */
export function clearReadAlongHighlight(): void {
  highlights()?.delete(READ_ALONG_HIGHLIGHT);
}
