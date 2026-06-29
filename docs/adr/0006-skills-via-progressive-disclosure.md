# ADR-0006: Skills load via progressive disclosure

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-28

## Context and Problem Statement

Skills are `SKILL.md` folders (the Anthropic Agent Skills format: frontmatter + body + optional bundled files). The naive approach injects every enabled skill's full instructions into the system context on every send. With several skills enabled, that floods the context window with instruction packs the model mostly doesn't need for a given turn — the exact context pollution this redesign exists to fix. We need a way to make many skills available without paying their full cost on every request.

## Decision Drivers

* Context-window efficiency — cost should scale with *use*, not with *count enabled*
* Keep the no-tools invariant intact when no skill is enabled
* Consistency with the declarative, no-code-execution model ([ADR-0004](./0004-plugins-are-declarative.md))

## Considered Options

* **Option 1:** Progressive disclosure — inject only the skills index; load each body on demand via a tool
* **Option 2:** Eager injection — inject every enabled skill's full instructions on every send

## Decision Outcome

Chosen option: **Option 1 — progressive disclosure**, because it lets a user enable many skills while the per-request context cost stays a few index lines. Only the enabled skills' **index** (name + description) goes into the system context (`buildSkillsIndexText` in `src/lib/skills.ts`, pushed in `loadSharedSystemBlocks`). The model loads a skill's full **body on demand** by calling the built-in `skill__load_skill` tool; bundled files load via `read_skill_file`. The `skill` MCP server (`src-tauri/src/mcp/skill_tool.rs`) is exposed only when ≥1 skill is enabled, preserving the no-tools invariant.

### Consequences

* **Positive:** Enabling many skills costs a few index lines, not many instruction packs — context scales with *use*, not with *count enabled*. The design stays consistent with the declarative model ([ADR-0004](./0004-plugins-are-declarative.md)): snak never executes skill-bundled code, and reads are path-checked and confined to the skill folder / per-thread workspace sandbox.
* **Negative:** Loading a skill now takes a tool round-trip (the model must call `load_skill` before it sees the body) — a deliberate trade of one round-trip for a clean context. Skills are also **not** a plugin category; they are standalone folders with their own Rust-owned discovery and enable-state (`src-tauri/src/skills/mod.rs`, mirroring the plugins module), which is a second subsystem to maintain.

## Pros and Cons of the Options

### Option 1 — Progressive disclosure

* **Good:** Per-request context cost scales with use, not with how many skills are enabled.
* **Good:** Keeps the no-tools invariant when no skill is enabled (server exposed only when ≥1 is).
* **Good:** Consistent with the declarative, path-checked, no-execution model.
* **Bad:** Each skill use costs a tool round-trip; adds a standalone skills subsystem alongside plugins.

### Option 2 — Eager injection

* **Good:** No round-trip — the model always has every enabled skill's full body available.
* **Good:** Simpler control flow (no on-demand loading tool).
* **Bad:** Floods the context window with instruction packs the model usually doesn't need — the context pollution that motivated the redesign.
* **Bad:** Cost grows with the number of enabled skills, discouraging users from enabling many.
