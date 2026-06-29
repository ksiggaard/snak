# T47 — Bug: token-usage chart hover flicker

- **Status:** done
- **Owner:** Claude (T47)
- **Priority:** P2
- **Layer:** Frontend
- **Depends on:** T16/T27 (usage view)

(IDEAS 18.) Hovering the activity heatmap made the interface jump/flicker.

**Notes:**
- 2026-06-13 (Claude): Two causes in `usage/UsageView.tsx`'s `DayTooltip`: (1) position was
  computed in a `useEffect` (post-paint), so the tooltip painted once unpositioned then jumped —
  switched to `useLayoutEffect` (pre-paint); (2) the tooltip's initial style was only
  `visibility:hidden`, leaving it `position:static` and reserving space in the cell grid (the
  "jumping interface") — now starts `position:fixed` at the origin so it's out of flow until
  positioned. Verified: full frontend gate.
