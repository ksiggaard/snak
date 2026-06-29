# T22 — Resizable sidebar + show/hide toggle

- **Status:** done
- **Owner:** WS-C
- **Priority:** P1 (reclaim space; pairs with T21)
- **Layer:** React
- **Depends on:** —

The sidebar (`ThreadList.tsx`) is a fixed `w-64`. Make it user-resizable by dragging its
edge, and add a button to toggle it hidden/shown.

**Acceptance criteria:**
- A drag handle on the sidebar's right edge resizes its width within a sensible min/max;
  the chosen width persists (localStorage, mirroring the theme preference, or the `settings`
  table).
- A toggle button (header or sidebar) hides/shows the sidebar; the open/closed state persists.
- The chat column reflows to fill the freed space; behaves well with T21 responsive rules.

- 2026-06-10 (WS-C): A custom `SidebarResizeHandle` (pointer events, rAF-coalesced) on the
  aside's right edge resizes within `SIDEBAR_MIN..MAX` (200–480px, default 256 = old `w-64`),
  applied as an inline `style={{ width }}` (Tailwind v4 can't class a runtime px). Width,
  open/closed, and mode are pure-UI prefs in **localStorage** via `src/lib/layout.ts` +
  `src/store/layout.ts` (mirrors `theme.ts`, seeded synchronously to avoid a flash;
  `clampSidebarWidth` + persistence unit-tested in `layout.test.ts`). A collapse toggle in
  `SidebarHeader` hides the inline sidebar; a slim in-flow toggle bar in `main` shows a reopen
  button (desktop, when collapsed) / hamburger (narrow) so the user is never stranded. No
  `react-resizable-panels` dependency. The handle is `hidden md:block` (moot when overlaying).
