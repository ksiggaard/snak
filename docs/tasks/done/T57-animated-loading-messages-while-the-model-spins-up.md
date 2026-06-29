# T57 — Animated loading messages while the model spins up

- **Status:** done
- **Owner:** Claude (T57)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** — (T46 if a UI-animations toggle should gate it)

(IDEAS 2.) Models are sometimes slow to start replying. During that pre-first-token gap,
replace the static "Thinking…" with a rotating pool of loading messages rendered with fancy
text animations, so the wait reads as lively rather than stalled.

**Acceptance criteria:**
- During the existing `pending` window (`src/components/chat/ChatView.tsx:163`), cycle
  through a set of loading messages instead of a single fixed string.
- Messages animate via CSS — reuse `tw-animate-css` + the keyframes in `src/index.css`;
  **no new JS animation dependency**.
- The first streamed token hands control back to the growing assistant bubble exactly as
  today.
- Honors reduced-motion / the T46 UI-animations toggle where applicable.

**Notes:**
- 2026-06-17: Implemented. Pool of 6 i18n phrases (`chat.loading.0`–`chat.loading.5`) cycling every 2.2 s with a CSS fade-slide-in keyframe (`snak-loading-message-in`). Pure cycling logic in `src/lib/loadingMessages.ts` with 7 unit tests. Animations toggle (T46) gates the CSS animation class so when animations are off the text still rotates but without motion. `prefers-reduced-motion` is automatically honoured via the existing global CSS kill-switch. All 5 language packs updated. Full gate passed (build ✓, lint ✓, 618 tests ✓).
