# T24 — Sidebar mode shift: Chats vs Projects

- **Status:** done
- **Owner:** WS-C
- **Priority:** P2
- **Layer:** React
- **Depends on:** T20

Projects (T20) take up too much sidebar space by default. Add a mode switch so the sidebar
shows either Chats or Projects, not both at once.

**Acceptance criteria:**
- A segmented control / tabs at the top of `ThreadList` switches between "Chats" and
  "Projects"; the selected mode persists.
- Chats mode lists threads (including Favorites from T23 if present); Projects mode lists
  projects, and opening one shows that project's threads.
- Default mode is Chats; project-less threads remain reachable.

- 2026-06-10 (WS-C): A `ToggleGroup` mode switch (`SidebarModeSwitch.tsx`) at the top of the
  sidebar flips between **Chats** (`ChatsPane` — favorites + a flat list of ALL threads, so
  project-less ones are always reachable) and **Projects** (`ProjectsPane` — the project list;
  opening one shows its detail view and reveals its threads). Mode persists in localStorage
  (`useLayout.sidebarMode`, default `chats`). The mode-appropriate "New chat"/"New project"
  action sits in the sidebar's action row.
