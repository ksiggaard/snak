/**
 * Pure helpers for Markdown rendering. Kept free of React/DOM so they can be
 * unit-tested in isolation (see `markdown.test.ts`).
 */

/**
 * Extract a fenced-code-block language from the `className` react-markdown puts
 * on a `<code>` element. react-markdown/rehype emit `language-<lang>` (and, with
 * `rehype-highlight`, also `hljs`). Returns the lowercased language id, or `null`
 * when no language is present (e.g. an indented block or a bare fence).
 *
 * The returned id is what later tasks (T17 "open in terminal") match on to
 * detect `bash`/`sh` blocks, so it is surfaced verbatim on the rendered element
 * via `data-language`.
 */
export function languageFromClassName(
  className: string | undefined,
): string | null {
  if (!className) return null;
  for (const cls of className.split(/\s+/)) {
    const m = /^language-([\w+#.-]+)$/i.exec(cls);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Flatten a Markdown message into a one-line plain-text snippet (T35 sidebar
 * preview rows). A pragmatic regex flattener, not a full parser: fence markers,
 * heading/list/blockquote prefixes, table chrome, and inline emphasis/code
 * markers are stripped (code *content* and link/image text are kept — they are
 * often the useful preview), whitespace is collapsed to single spaces, and the
 * result is truncated to `maxLen` with an ellipsis.
 */
export function flattenSnippet(markdown: string, maxLen = 120): string {
  const flat = markdown
    // Code-fence marker lines go away; the code itself stays.
    .replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, " ")
    // Images → alt text, links → link text.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Line-start structure: headings, blockquotes, list markers, checkboxes.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>+[ \t]?/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/^\[(?:[ xX])\][ \t]+/gm, "")
    // Horizontal rules, setext underlines, and table separator rows; then the
    // pipes of remaining table rows.
    .replace(/^[ \t]*[=|\-: \t]+$/gm, " ")
    .replace(/\|/g, " ")
    // Inline emphasis / strikethrough / code markers.
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
}

/** Extract the plain-text content of a code block from react-markdown children. */
export function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(codeText).join("");
  if (
    children &&
    typeof children === "object" &&
    "props" in children &&
    children.props &&
    typeof children.props === "object" &&
    "children" in children.props
  ) {
    return codeText((children.props as { children: unknown }).children);
  }
  return "";
}
