# T25 — Move app chrome into the sidebar (reclaim chat vertical space)

- **Status:** done
- **Owner:** WS-C
- **Priority:** P2
- **Layer:** React
- **Depends on:** —

The chat's vertical space is wasted on the app title, model picker, Usage/Settings buttons,
and color-scheme toggle in the header (`src/App.tsx`). Move these into sidebar sections or a
menu (button/dropdown) so the chat area is taller.

**Acceptance criteria:**
- App title, `ThemeToggle`, and the Usage/Settings entry points relocate from the header
  into the sidebar (e.g. a header/footer area of `ThreadList`) or a dropdown menu.
- The `ModelPicker` moves to the sidebar or becomes a compact control near the composer —
  pick one and keep it one click away.
- The chat header is removed or minimized so `MessageList`/`Composer` gain the reclaimed
  height.

**Notes:** Touches `src/App.tsx` (header block), `ModelPicker`, `ThemeToggle`, and the
`SettingsView` entry point. Composes with T21 (responsive) and T22 (sidebar toggle).

- 2026-06-10 (WS-C): The chat `<header>` in `App.tsx` is **removed**. The app title, an
  overflow `DropdownMenu` (Settings, Usage, and a Theme radio group replacing `ThemeToggle`),
  and the collapse toggle now live in `SidebarHeader.tsx`. View routing moved to a small
  `store/view.ts` (`chat | settings | usage`); project/search panes still come from their own
  stores. Per the chosen design, the **ModelPicker moved to a compact control just above the
  composer** (rendered at the top of `Composer.tsx`, height reserved to avoid a null→select
  shift). `ThreadList.tsx` was split into `Sidebar`/`SidebarContent`/`SidebarHeader`/
  `SidebarModeSwitch`/`ChatsPane`/`ProjectsPane`/`ThreadRow` and removed. New shadcn/ui
  components added (against the unified `radix-ui` package): `dropdown-menu`, `tooltip`,
  `sheet`, `toggle-group` (+ `toggle`). Verified: `npm run build`/`lint`/`test` (176) and
  `cargo build`/`clippy`/`fmt`/`test` (41) all pass.
