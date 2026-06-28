# T46 — UI animations with an Appearance toggle

- **Status:** done
- **Owner:** Claude (T46)
- **Priority:** P2
- **Layer:** Frontend
- **Depends on:** T30/T33 (Appearance), T36 (incognito identity)

(IDEAS 17.) Add tasteful motion that makes the app feel polished — view transitions, the
sidebar animating in, a thinking animation, an incognito ghost touch — with an Appearance
setting to toggle them off.

**Acceptance criteria:**
- A global animations on/off in Appearance settings, persisted; off = a fully static UI.
- View/screen transitions, sidebar enter, an animated thinking indicator, an incognito
  ghost animation, all gated by the toggle.

**Notes:**
- 2026-06-13 (Claude): `animations: boolean` (default on) added to the appearance store
  (`store/appearance.ts`) + `lib/appearance.ts` helpers (`getStoredAnimations`/`storeAnimations`/
  `applyAnimations`), persisted in localStorage (`animations` = "0" when off, absent = on) and
  applied at bootstrap by toggling a `.no-animations` class on `<html>`. The kill-switch
  (`index.css`) collapses every transition/animation to ~0; OS `prefers-reduced-motion` is
  honored the same way. Motion added (tw-animate-css utilities + two small keyframes): keyed
  view fade-in (`App.tsx`), inline sidebar `slide-in-from-left`+fade (`Sidebar.tsx`), a
  three-dot pulsing thinking indicator (`MessageList.tsx`, `snak-thinking-dot`), and a gentle
  float on the incognito explainer ghost (`ChatView.tsx`, `snak-ghost-float`). New `animations.*`
  i18n keys in the catalog + all five packs; `AnimationsCard` (On/Off ToggleGroup) in
  `settings/Appearance.tsx`. Round-trip test added. Verified: `npm run build`/`lint`/`test` (447).
