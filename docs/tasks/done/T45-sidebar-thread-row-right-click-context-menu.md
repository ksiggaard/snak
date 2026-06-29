# T45 — Sidebar thread-row right-click context menu

- **Status:** done
- **Owner:** Claude (T45)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** T23 (favorites), T20 (projects)

Right-clicking a sidebar thread row opens a context menu mirroring the existing row actions,
so the per-row affordances aren't limited to the hover menu button.

**Acceptance criteria:**
- Right-click (and the kebab button) opens a menu with: favorite/unfavorite, move-to-project
  (submenu: "No project" + each project), rename, and delete (destructive).
- Reuses existing store actions and i18n keys; no new keys needed.

**Notes:**
- 2026-06-13 (Claude): Added shadcn `src/components/ui/context-menu.tsx` (Radix) and wrapped
  the row in `ThreadRow.tsx` with `ContextMenu`. Items reuse `toggleFavorite`, the projects
  list/move action, rename, and delete — all gated like the existing kebab menu (disabled while
  editing). Reuses `sidebar.*`/`panel.*`/`common.*` keys already in every pack. Verified with
  the full gate.
