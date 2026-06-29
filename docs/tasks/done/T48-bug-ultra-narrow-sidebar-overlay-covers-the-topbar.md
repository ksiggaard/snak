# T48 — Bug: ultra-narrow sidebar overlay covers the topbar

- **Status:** done
- **Owner:** Claude (T48)
- **Priority:** P1
- **Layer:** Frontend
- **Depends on:** T21/T25 (responsive chrome)

(IDEAS 19.) At ultra-narrow widths the overlay sidebar (`Sheet`) didn't account for the
topbar — it covered the TitleBar/MenuBar and its own hamburger.

**Notes:**
- 2026-06-13 (Claude): The shadcn `Sheet` uses `inset-y-0`/`h-full` (full viewport from top).
  Offset the sidebar `SheetContent` in `App.tsx` via inline `style` (beats the classes) to start
  below the chrome — `top: 32` (TitleBar h-8), or `60` when the inline MenuBar (h-7) is shown —
  with matching `height: calc(100% - …)`. Verified across ~360–768px.
