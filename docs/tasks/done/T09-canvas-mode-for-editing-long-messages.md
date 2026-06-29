# T9 — Canvas mode for editing long messages

- **Status:** done
- **Owner:** Wave4-T9
- **Priority:** P2
- **Layer:** Frontend
- **Depends on:** T8

(README idea 2.) A larger side/overlay "canvas" surface for composing and editing long
Markdown messages, with a live preview, rather than the compact `Composer` textarea.

**Acceptance criteria:**
- Toggle a canvas view that edits Markdown with a live rendered preview (reusing T8's
  renderer).
- Content round-trips into the normal send flow (the store's `send`); images still attach.
- Sensible UX for opening/closing without losing draft content.

**Notes:**
- 2026-06-09 (Wave4-T9): Implemented as a frontend-only overlay. New
  `src/components/chat/Canvas.tsx` — a full-screen modal (`fixed inset-0`,
  backdrop blur) with a split pane: a monospace Markdown editor on the left and a
  live rendered **preview reusing T8's `<Markdown>`** on the right. Toggled from a
  new expand button (`Maximize2`) in the `Composer` button row.
  - **Draft round-trips with zero copying:** the canvas does NOT own state — the
    draft `text`/`images` stay in `Composer.useState`, and the canvas edits them
    via `onChange`/`onRemoveImage` props. So opening/closing the canvas (Esc or the
    X button) leaves the exact same draft in the compact textarea, and vice-versa;
    typing in either surface is the same state. Send from the canvas calls the
    Composer's existing `send()` (same `onSend` prop → store `send`), which clears
    the draft and closes the canvas; images attached in the composer are sent too
    and previewable/removable in the canvas footer.
  - **UX:** Cmd/Ctrl+Enter sends from the canvas (plain Enter inserts newlines,
    unlike the compact composer's Enter-to-send, since this is a long editor); Esc
    closes keeping the draft; Send is gated on the same `canSend` (provider
    enabled + key present + non-empty) as the composer.
  - **Owned-set only:** edited `Composer.tsx` (deep-edit, owned) + added
    `Canvas.tsx`; **no** `ChatView.tsx`/store/`MessageList`/Rust changes were
    needed — the canvas hosts entirely inside the composer. No new pure helper was
    extracted (the change is UI composition over existing state), so no new
    `*.test` file; the existing 108 tests still pass.
  - Verified: `npm run build` (tsc + vite) ✓, `npm run lint` ✓, `npm test`
    (108 pass) ✓.
