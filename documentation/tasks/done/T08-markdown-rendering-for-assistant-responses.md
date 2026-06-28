# T8 — Markdown rendering for assistant responses

- **Status:** done
- **Owner:** Wave1-T8
- **Priority:** P1
- **Layer:** Frontend
- **Depends on:** —

(README idea 1.) Assistant messages are currently rendered as plain text in
`src/components/chat/MessageList.tsx`. Render Markdown — headings, lists, links, tables,
inline code, and fenced code blocks with syntax highlighting.

**Acceptance criteria:**
- Markdown in assistant messages renders richly (e.g. `react-markdown` + `remark-gfm`);
  fenced code blocks get language-aware syntax highlighting and a copy-to-clipboard button.
- Rendering is XSS-safe (no raw HTML injection) and themed via the existing CSS variables
  in `src/index.css` (works in light/dark).
- Streaming still works — partial/incomplete Markdown during a stream degrades gracefully
  (no crash on an unclosed code fence).

**Notes:**
- Foundational for T10's code-block terminal button and T9's canvas editing.
- 2026-06-09 (Wave1-T8): Assistant messages now render Markdown via
  **`react-markdown` + `remark-gfm`**, with **`rehype-highlight`** (highlight.js,
  github light + github-dark themes) for fenced-code syntax highlighting. New
  `src/components/chat/Markdown.tsx` (renderer; XSS-safe — no `rehype-raw`),
  `CodeBlock.tsx` (copy-to-clipboard + language badge), `lib/markdown.ts` (pure
  helpers `languageFromClassName`/`codeText`, unit-tested in `markdown.test.ts`),
  and a generated `highlight-theme.css` (github-dark scoped under `.dark`).
  `MessageList.tsx` renders assistant `content` through `<Markdown>`; user
  messages + images unchanged. Streaming-safe: react-markdown re-parses the
  growing string each token and tolerates unclosed fences. **Code-fence language
  for T17** is surfaced as a `data-language` attribute on the CodeBlock wrapper
  (plus the original `language-<lang>` class on `<code>`), parsed by
  `languageFromClassName`. Verified: `npm run build`/`lint`/`test` all pass
  (48 tests). No files edited beyond the owned set.
