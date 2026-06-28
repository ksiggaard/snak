# T33 — Appearance: font family + size for UI and chat

- **Status:** done
- **Owner:** Agent-T30-T33
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 6.) Let the user choose fonts and font sizes from the Appearance panel — separately
for the **app UI** and for **chat content** (messages), since reading prose and scanning
chrome have different needs.

**Acceptance criteria:**
- Settings → Appearance gains a typography section with: UI font family, chat font
  family, UI font size, and chat font size (sizes as a small step range, e.g. S/M/L/XL or
  a px slider with sane bounds), each with reset-to-default.
- Font family options: the bundled default plus system/common fonts. Decide and document
  the source — a curated list (safe) vs. enumerating installed system fonts (needs a Rust
  command; `font-kit`/`fontdb` or platform tooling). A free-text family input is an
  acceptable escape hatch.
- Applied via CSS variables (e.g. `--font-sans` for UI, a new `--font-chat` consumed by
  `MessageList`/`Markdown` content, and a root font-size token) so it composes with
  themes (T11) and light/dark; persisted in localStorage and applied synchronously at
  startup, no flash (mirror `lib/theme.ts`).
- Chat font settings affect message rendering (including Markdown body, but **not** code
  blocks' monospace) without breaking layout; UI size changes keep the title bar,
  sidebar, and composer usable at min/max.

**Notes:**
- Mind WebKitGTK font rendering quirks on Linux; verify the chosen mechanism there.
- Code blocks keep their mono stack — only consider a separate mono override if cheap.
- 2026-06-12 (Agent-T30-T33): Implemented. New "Typography" card in `Appearance.tsx`
  (UI font, chat font, UI size, chat size — each with Reset); CSS builders/persistence
  in `src/lib/appearance.ts` (unit-tested), state in `src/store/appearance.ts`, applied
  via `<style id="custom-typography">` (separate element from the T30 colors one).
- 2026-06-12: **Decisions** — (1) Font source is a **curated list** (`FONT_OPTIONS`:
  System default, Inter, Roboto, Open Sans, Noto Sans, Lato, Source Sans 3, Georgia,
  Noto Serif, system serif, JetBrains Mono, system monospace) + a **free-text input**
  ("Custom…") as the escape hatch — no Rust font enumeration. Free text is sanitized
  (`cssFontFamily`: strips CSS-breaking chars, quotes names, appends a generic
  fallback). (2) Sizes are **px sliders**: UI 13–18px (default 16) applied as the root
  `html { font-size }` so all rem-based sizing scales; chat 14–20px (default 14).
  (3) UI family sets `--font-sans` **and** explicit `font-family` on
  `html, body, .font-sans, .font-heading` — required because Tailwind v4's
  `@theme inline` inlines token values into utilities, so overriding the variable alone
  wouldn't restyle them.
- 2026-06-12: Chat font/size apply through new tokens `--font-chat` /
  `--chat-font-size`, consumed by a `.chat-content` class added (one-line touch) to the
  message-content wrapper in `MessageList.tsx` — inert when nothing is customized, so
  the upcoming MessageList restyle (T34) only needs to keep that class on the content
  wrapper. Inner `text-sm` utilities are neutralized to `inherit` (and
  `text-base`/`text-lg` markdown headings remapped to em) so the pick reaches the
  prose; code blocks keep `font-mono` (own declaration wins over inheritance).
  Persisted in localStorage key `custom-typography`; module-level startup apply (same
  path as T30), no flash. Verified: `npm run build`, `npm run lint`, `npm test`
  (243 passed, incl. 23 new appearance tests) all green.
