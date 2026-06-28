# T34 — Chat layout styles (bubbles & friends)

- **Status:** done
- **Owner:** Agent-T34-T35
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 7.) An Appearance option choosing how messages render in the chat. The current
style stays the default; add a few distinct, genuinely useful alternatives.

**Acceptance criteria:**
- An Appearance "Chat style" selector with (at least) these modes:
  - **Default** — the current flat full-width layout, unchanged.
  - **Bubbles** — messenger-style: user messages right-aligned in accent-tinted bubbles,
    assistant left-aligned in muted bubbles, capped bubble width.
  - **Compact** — dense, IRC-like: minimal padding, small role prefix on one line with
    the text, tight markdown spacing; for small windows / long sessions.
  - **Document** — distraction-light reading mode: user prompts render as section
    headings/quotes, assistant prose flows full-width like an article.
- Implemented as a presentation concern only in `src/components/chat/MessageList.tsx`
  (+ a wrapper class consumed by styles) — no store/DB/message-shape changes; streaming,
  images, code blocks, copy buttons, and the scroll-to-search-hit flash (T19) work
  identically in every mode.
- Persisted like the other appearance prefs (localStorage, synchronous at startup);
  switching modes re-renders live without losing scroll position (best-effort).
- Each mode is usable in light + dark and with installed themes (use tokens, not
  hardcoded colors).

**Notes:**
- Keep modes few and distinct — a mode should change reading ergonomics, not just
  decoration. Bubble mode interacts with wide content (tables/code): let such blocks
  break out of the capped width rather than squish.
- 2026-06-12 (Agent-T34-T35): Implemented. Pref `chatStyle`
  (default/bubbles/compact/document) lives with the other appearance prefs:
  persistence helpers in `src/lib/appearance.ts` (localStorage key `chat-style`,
  absent/unknown → "default", unit-tested), state + setter on `useAppearance`
  (`src/store/appearance.ts`, seeded synchronously — no flash, no CSS injection
  needed since it's a pure render-mode pref). Appearance gains a "Chat style"
  card (ToggleGroup) in `settings/Appearance.tsx`.
- 2026-06-12: `MessageList.tsx` restyle is presentation-only: the non-summary
  branch moved into a `ChatMessage` helper (same ref/id wiring for the T19
  scroll/flash, same images/tool-chips/Markdown/meta children in every mode,
  `chat-content` T33 font hook kept on the content wrapper; the T28 summary
  divider renders identically in all modes). Per-mode classes via
  `styleClasses()`; the scroll container gets a `chat-style-<mode>` hook class.
  **Bubbles:** user right in `bg-primary/10`, assistant left in `bg-muted`, both
  capped at 75%; an unlayered `:has(pre, table)` rule in `index.css` lets an
  assistant bubble with code/tables break out to full width instead of
  squishing. **Compact:** gap-1/p-2 container, fixed-width "you"/"ai" gutter
  prefix, Markdown margins tightened by `.chat-style-compact` rules in
  `index.css` targeting the my-/mt-/mb- utility classes (same trick as T33's
  `:where(.text-sm)` overrides — unlayered beats Tailwind's layered utilities).
  **Document:** user prompts as full-width `border-l-2 border-primary/60
  text-base font-semibold` section headings, assistant prose full-width, gap-6.
  All colors are tokens (`bg-primary/10`, `bg-muted`, `border-primary/60`), so
  modes follow light/dark + installed themes. Mode switches don't touch the
  scroll effect's deps, so scroll position survives (best-effort).
  Verified: `npm run build`, `npm run lint`, `npm test` (274 passed) green.
