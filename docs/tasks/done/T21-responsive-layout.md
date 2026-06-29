# T21 — Responsive layout (adapt the UI from narrow to wide)

- **Status:** done
- **Owner:** WS-C
- **Priority:** P1 (usability across window sizes; the app is meant to run small/quick too)
- **Layer:** React (Tailwind)
- **Depends on:** —

The app chrome assumes a wide window: the sidebar (`src/components/sidebar/ThreadList.tsx`,
fixed `w-64`), the header (`src/App.tsx`), the two-pane Settings (`src/components/settings/
SettingsView.tsx`), and the composer. Make the layout adapt cleanly from narrow to wide so
nothing clips or overflows. (The fixed-size quick-input overlay is out of scope.)

**Acceptance criteria:**
- At narrow widths the sidebar collapses or overlays instead of squeezing the chat column;
  the Settings two-pane stacks (or its section nav collapses to a dropdown/scroller).
- Header controls (title, `ModelPicker`, Usage/Settings buttons, `ThemeToggle`) wrap or
  condense rather than overflowing.
- No horizontal scrollbars or clipped controls between roughly 480px and 1400px wide.
- Prefer Tailwind responsive utilities over JS resize listeners.

**Notes:** Composes with T22 (resizable/toggleable sidebar) and T25 (moving chrome into the sidebar).
- 2026-06-10 (WS-C): Done as part of the coherent sidebar/layout overhaul. `md` (768px)
  is the inline⇄overlay boundary: at >= md the sidebar is an inline `<aside>`; below md it
  renders as a left `Sheet` overlay opened by a hamburger in `main` (`App.tsx`). The
  `SettingsView` two-pane now stacks (`flex-col md:flex-row`) with the section nav as a
  horizontal `overflow-x-auto` strip on narrow / vertical `md:w-44` on wide. `main` is
  `min-w-0` and uses `p-3 md:p-4`; no horizontal scrollbars ~480–1400px. Tailwind utilities
  only (no JS resize listeners). The chat header was removed (T25) so there are no header
  controls left to overflow.
