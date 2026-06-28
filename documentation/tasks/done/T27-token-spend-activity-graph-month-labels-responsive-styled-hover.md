# T27 — Token-spend activity graph: month labels, responsive, styled hover

- **Status:** done
- **Owner:** WS-B
- **Priority:** P3
- **Layer:** React
- **Depends on:** T16
- **Notes (2026-06-10):** Added `monthLabelColumns` pure helper (TDD, unit-tested); responsive `ActivityHeatmap` via `ResizeObserver` callback ref that trims visible columns to fit container width; replaced `title` attribute with `DayTooltip` (fixed-position, popover/design-token styled) showing date + input/output/cache breakdown. Extended `DailyUsage` and `HeatmapCell` types with token breakdown fields.

The GitHub-style activity graph in the usage view (`src/components/usage/UsageView.tsx`,
from T16) needs month indicators, should be responsive to width, and its per-day hover
popup should be styled.

**Acceptance criteria:**
- Month labels render above the columns, aligned to week boundaries.
- The graph adapts to the available width (column count/size) without overflowing; works
  with T21.
- Hovering a day shows a styled tooltip (date + input/output/cache token counts) using the
  app's popover tokens, not a raw `title` attribute.

**Notes:** Builds on the existing usage view and the usage data layer (`src/lib/usage.ts`)
from T16.

---

# Backlog (from IDEAS.md, 2026-06-12)

Sourced from `IDEAS.md`. Coarse-grained — refine acceptance criteria (and consider a
design pass) before claiming one.
