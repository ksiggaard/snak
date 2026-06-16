# Chat max-width + per-reply full-width toggle

**Date:** 2026-06-16
**Status:** Approved (design) — ready for implementation planning

## Goal

Two related layout changes to the chat surface:

1. **Cap the chat width.** Messages and the composer get a configurable maximum
   width. When the chat area is wider than the cap, the conversation column
   centers in the available space; when it's narrower, the column fills the
   width (no centering). On by default at a comfortable reading measure
   (~760px), adjustable and dismissable from Appearance settings.

2. **Per-reply full-width toggle.** A small control on each assistant reply
   that expands that single reply to the full container width, overriding the
   cap. Session-only — it resets when the app restarts (matches the existing
   per-session UI patterns; no DB migration).

## Key architectural decision

The width cap is applied **per message row** (and to the composer), **not** as a
single wrapper around the whole transcript.

This is forced by requirement 2: one reply must be able to break out to full
width while its neighbours stay capped. Each message row becomes
`mx-auto w-full` with an inline `max-width`. In a flex column, `margin: auto`
on a flex item centers it on the cross (horizontal) axis only when there's free
space — so the column centers when the chat area is wider than the cap and
collapses to a left/full layout when it isn't, which is exactly the requested
"center only if the container is larger than the cap" behaviour. A reply toggled
full-width simply drops its cap (`max-width: undefined`). This is the
ChatGPT-style independently-centered-turn layout.

**Rejected alternative:** one centered max-width wrapper around all messages.
Simpler, but a per-reply break-out would then require negative-margin or portal
hacks to exceed the wrapper — worse isolation and more fragile.

## Components & changes

### 1. Appearance pref — `src/lib/appearance.ts`

- Add `CHAT_WIDTH: SizeRange = { min: 560, max: 1280, fallback: 760 }`.
- Model the preference as `chatMaxWidth: number | null`:
  - a **number** = capped at that many px (cap on),
  - `null` = **off** (full width, no cap).
  - Default (nothing stored) = `760` (on).
- `getStoredChatMaxWidth(): number | null` — localStorage key `chat-max-width`:
  - key absent → `760` (default on),
  - stored `"off"` → `null`,
  - stored number → `clampSize(n, CHAT_WIDTH)`,
  - unparseable/NaN → `760`.
- `storeChatMaxWidth(v: number | null): void`:
  - `null` → store `"off"`,
  - `v === CHAT_WIDTH.fallback` (760) → remove the key (back to default),
  - else → store `String(clampSize(v, CHAT_WIDTH))`.
- Pure functions; no CSS injection (this is a render-mode pref consumed by
  React, like `chatStyle`/`chatListStyle`, not an injected-CSS pref).

**Note (deliberate simplification):** toggling the cap off and back on restores
the default 760px; a previously-set custom width is not remembered across an
off cycle. Acceptable for v1.

### 2. Appearance store — `src/store/appearance.ts`

- Add state `chatMaxWidth: number | null`, seeded from `getStoredChatMaxWidth()`.
- Add action `setChatMaxWidth(v: number | null)` → `storeChatMaxWidth(v)` then
  `set({ chatMaxWidth: v })`. No `apply*` call (no injected CSS).

### 3. `MessageList` — `src/components/chat/MessageList.tsx`

- Read `chatMaxWidth` from `useAppearance`.
- Session state for full-width replies:
  `const [wideIds, setWideIds] = useState<Set<string>>(() => new Set())`, with a
  `toggleWide(id)` that returns a new Set (immutable update).
- For each message, compute the **effective max width**:
  `wideIds.has(m.id) || chatMaxWidth == null ? undefined : chatMaxWidth`.
  Pass it to `ChatMessage` (applied as `mx-auto w-full` + inline
  `style={{ maxWidth }}` on the row's outer div).
- The full-width toggle is offered (button rendered) only when **the cap is on
  (`chatMaxWidth != null`)** and the message is a **saved assistant reply**
  (`role === "assistant"`, `kind === "normal"`, real id — not the streaming
  placeholder). Pass `wide` (current state) and `onToggleWide` down for those.
- The **summary divider** rows and the **"Thinking…"** pending indicator are
  wrapped in the same centered container at the cap (`mx-auto w-full` +
  `maxWidth = chatMaxWidth ?? undefined`); they never get a per-row toggle.
- The empty state (`EmptySuggestions`) already self-centers — left unchanged.

### 4. `ChatMessage` / `AssistantMeta` — same file

- `ChatMessage` accepts `maxWidth?: number` (the effective, post-toggle value)
  and applies `mx-auto w-full` + `style={{ maxWidth }}` to its outer row `<div>`
  across all chat-style branches (default/bubbles/cards/zebra/document via the
  shared row div, plus the dedicated compact/cozy/terminal branches).
- `ChatMessage` also accepts optional `wide?: boolean` and
  `onToggleWide?: () => void`, threaded into `AssistantMeta`.
- `AssistantMeta` gains optional `wide?` + `onToggleWide?`. When `onToggleWide`
  is provided, render an icon button next to Copy:
  - not wide → expand icon, title/aria `chat.fullWidth`,
  - wide → restore icon, title/aria `chat.exitFullWidth`.
  - Icons: prefer lucide `UnfoldHorizontal` / `FoldHorizontal`; fall back to
    `Maximize2` / `Minimize2` if those aren't available in the installed lucide
    version (verify at implementation).
- The streaming placeholder has an empty `created_at`, so `AssistantMeta`
  returns `null` and shows no toggle until the reply is saved — intended.

### 5. Composer alignment — `src/components/chat/ChatView.tsx`

- Read `chatMaxWidth` from `useAppearance`.
- Wrap the bottom stack (the `error` text, `ApprovalGate`, and `Composer`) in a
  centering container: `mx-auto w-full` + `style={{ maxWidth: chatMaxWidth ?? undefined }}`.
  So the input lines up under the message column.
- The composer always follows the global setting; it has no per-reply toggle.
- When the cap is off (`null`), `maxWidth` is `undefined` → full width, as today.

### 6. i18n — `src/lib/i18n.ts` (English catalog only)

The `en` catalog is the source of truth; other locale packs (da/de/es/fr/pl)
fall back to English automatically, so only these keys are added:

- `chatWidth.title`: "Chat width"
- `chatWidth.description`: "Cap how wide messages and the composer get on large
  windows, centering the conversation. Individual replies can still be expanded
  to full width."
- `chatWidth.label`: "Limit width"
- `chatWidth.widthLabel`: "Max width"
- `chat.fullWidth`: "Full width"
- `chat.exitFullWidth`: "Fit to column"

### 7. Appearance settings card — `src/components/settings/Appearance.tsx`

- New `ChatWidthCard`, added to the `Appearance()` card list (after
  `ChatStyleCard`).
- An on/off `ToggleGroup` (mirroring `AnimationsCard`) bound to
  `chatMaxWidth != null`: Off → `setChatMaxWidth(null)`; On →
  `setChatMaxWidth(chatMaxWidth ?? CHAT_WIDTH.fallback)`.
- When on, a width slider (mirroring the existing `SizeRow` slider markup, but
  with a plain number value — no null/default semantics): `min`/`max` from
  `CHAT_WIDTH`, `value = chatMaxWidth`, `onChange → setChatMaxWidth(Number(...))`,
  plus a reset button that sets `CHAT_WIDTH.fallback`.

### 8. Tests — `src/lib/appearance.test.ts`

TDD the pure storage functions (vitest, localStorage reset in `beforeEach`):

- `getStoredChatMaxWidth()` returns `760` when nothing is stored.
- Stored `"off"` → `null`.
- Stored in-range number → that number; out-of-range → clamped to `CHAT_WIDTH`.
- Stored garbage / NaN → `760`.
- `storeChatMaxWidth(null)` then `getStoredChatMaxWidth()` → `null`.
- `storeChatMaxWidth(900)` round-trips to `900`.
- `storeChatMaxWidth(760)` removes the key (subsequent get → `760`).

## Out of scope (YAGNI)

- Persisting the per-reply full-width toggle across reloads (chosen
  session-only).
- Remembering a custom width across an off→on toggle cycle.
- Any "expand all replies" / global full-width control.
- Applying the cap to the empty/incognito explainer screens (they self-center).

## Risk / interaction notes

- `mx-auto` on a flex item in a column container centers on the cross axis only
  when free space exists, and explicit `width`/`max-width` overrides the default
  `align-items: stretch` — standard, well-supported flexbox behaviour.
- Per-row capping composes correctly with all chat styles: e.g. in `bubbles`,
  the 75%-width bubble is measured against the (now capped) row; in `default`,
  a right-aligned user bubble aligns to the capped column's right edge.
- The right-hand `ChatPanel`, when open, narrows the chat column; the cap then
  often won't engage (column ≤ cap), which is correct — centering only kicks in
  when there's surplus width.
- Scroll container, `data-chat-scroll` IntersectionObserver root, message refs,
  and scroll-to-message all stay on unchanged elements.
