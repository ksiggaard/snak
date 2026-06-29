# T15 — Skills support

- **Status:** done (Wave4-T15, 2026-06-09 — a skill = a `skill`-category T12
  plugin contributing `{name, instructions}`; enabled skills' instructions are
  composed by the pure `buildSkillsSystemText` (`src/lib/skills.ts`) and
  unshifted as a leading `role:"system"` message in `store/threads.ts` `send()`
  alongside the global guidance; a **Skills** settings card lists them with
  enable/disable toggles reusing the plugin enable/disable. Empty → no message.)
- **Owner:** Wave4-T15
- **Priority:** P3
- **Layer:** Frontend + Rust + plugins
- **Depends on:** T12

(README idea 8.) Reusable "skills" — packaged instructions/capabilities the model can use —
installable and managed like other plugin categories.

**Acceptance criteria:**
- A skill package format and a way to install/enable/disable skills (a plugin category
  under T12).
- Enabled skills are surfaced to the model (e.g. injected guidance and/or exposed as
  tools), and a settings UI manages them.

**Notes:**
- Scope deliberately once T12's host API exists; align the skill format with that API.
