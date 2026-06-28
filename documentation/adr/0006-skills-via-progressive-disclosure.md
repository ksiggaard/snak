# 0006. Skills load via progressive disclosure

- **Status:** Accepted
- **Date:** 2026-06-28

## Context

Skills are `SKILL.md` folders (the Anthropic Agent Skills format: frontmatter + body +
optional bundled files). The naive approach injects every enabled skill's full instructions
into the system context on every send. With several skills enabled that floods the context
window with instruction packs the model mostly doesn't need for a given turn — the exact
context pollution that motivated the redesign.

## Decision

**Progressive disclosure.** Only the enabled skills' **index** (name + description) goes into
the system context (`buildSkillsIndexText` in `src/lib/skills.ts`, pushed in
`loadSharedSystemBlocks`). The model loads a skill's full **body on demand** by calling the
built-in `skill__load_skill` tool. Bundled files load via `read_skill_file`. The `skill` MCP
server (`src-tauri/src/mcp/skill_tool.rs`) is exposed only when ≥1 skill is enabled,
preserving the no-tools invariant.

## Consequences

- Enabling many skills costs a few index lines, not many instruction packs — context scales
  with *use*, not with *count enabled*.
- Skills are **not** a plugin category; they're standalone folders (Rust-owned discovery +
  enable-state in `src-tauri/src/skills/mod.rs`, mirroring the plugins module).
- Loading a skill now takes a tool round-trip (the model must call `load_skill`) — a deliberate
  trade of one round-trip for a clean context.
- Consistent with the declarative model ([ADR 0004](./0004-plugins-are-declarative.md)):
  snak never executes skill-bundled code; reads are path-checked and confined to the skill
  folder / per-thread workspace sandbox.
