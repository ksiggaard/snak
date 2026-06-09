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
