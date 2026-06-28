# T7 — Fix stale status line in CLAUDE.md

- **Status:** done
- **Owner:** Agent A
- **Priority:** P3 (docs)
- **Layer:** Docs
- **Depends on:** —

`CLAUDE.md` "Project status" still says **"Scaffolded (Stage 0 complete)"**, but Stages
1–6 plus the quick-input/shortcut/screenshot work are implemented in the tree. Update the
status line to reflect reality (and note the remaining gap: system tray, T1).

**Acceptance criteria:**
- "Project status" accurately states what's built vs. outstanding. No other doc churn.

**Notes:**
- 2026-06-09 (Agent A): Rewrote the "## Project status" line in `CLAUDE.md` to reflect
  Stages 1–6 + quick-input/shortcut/screenshots built, with the system tray (this work)
  closing the last gap. No other sections touched.

---

# Product backlog (from README ideas)

Larger forward-looking features sourced from `README.md` "IDEAS". These are coarse-grained
and not yet sprint-scoped — refine the acceptance criteria (and consider a `brainstorming`
pass) before claiming one. Several are interdependent (notably the plugin system T12,
which T11/T14/T15 plug into).
