// Skills (Agent Skills standard) — frontend.
//
// A skill is a `SKILL.md` folder discovered by the Rust `skills` store. Only the
// *index* (name + description) is injected into the system context; the model
// pulls a skill's full body on demand via the built-in `skill__load_skill` tool
// (progressive disclosure — no context pollution). The Rust backend owns
// discovery, enable-state, and authoring; this module is the typed bridge plus
// the pure index builder.

import { invoke } from "@tauri-apps/api/core";

/** Skill metadata for the index + settings UI. Mirrors the Rust `SkillMeta`. The
 * body is fetched separately (`readSkill` / the `skill__load_skill` tool). */
export interface SkillMeta {
  /** Canonical name (frontmatter `name`, else folder slug). The id the model
   * calls `load_skill` with, and the enable-state key. */
  name: string;
  description: string;
  enabled: boolean;
  /** On-disk folder name (for edit/delete; not shown to the model). */
  slug: string;
}

// --- Tauri command wrappers --------------------------------------------------

export function listSkills(): Promise<SkillMeta[]> {
  return invoke<SkillMeta[]>("list_skills");
}

export function readSkill(name: string): Promise<string> {
  return invoke<string>("read_skill", { name });
}

/** Create or update a skill; returns the on-disk slug. Pass `slug` when editing
 * (so a rename cleans up the old folder). */
export function saveSkill(
  name: string,
  description: string,
  body: string,
  slug?: string,
): Promise<string> {
  return invoke<string>("save_skill", { name, description, body, slug });
}

export function deleteSkill(name: string): Promise<void> {
  return invoke("delete_skill", { name });
}

export function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  return invoke("set_skill_enabled", { name, enabled });
}

/** Import skill folders from a directory (a single `SKILL.md` folder or a parent
 * of them, e.g. `~/.claude/skills`). Returns the count imported. */
export function importSkills(dir: string): Promise<number> {
  return invoke<number>("import_skills", { dir });
}

/** Open a native folder picker; resolves to the chosen path, or null if the user
 * cancelled. (Folder selection runs in Rust — the JS dialog plugin isn't wired.) */
export function pickSkillsDir(): Promise<string | null> {
  return invoke<string | null>("pick_skills_dir");
}

// --- Index builder (pure, unit-tested) ---------------------------------------

/**
 * Build the leading system text listing the *enabled* skills by name +
 * description, and telling the model to call `skill__load_skill` to read one in
 * full when relevant. This is the whole of what skills add to the prompt by
 * default — the bodies stay on disk until the model asks for them.
 *
 * Returns an empty string when there are no usable skills, so callers add no
 * system message and the request is unchanged when skills are unused.
 */
export function buildSkillsIndexText(skills: SkillMeta[]): string {
  const lines = skills
    .map((s) => ({
      name: (s.name ?? "").trim(),
      description: (s.description ?? "").trim(),
    }))
    .filter((s) => s.name !== "")
    .map((s) => (s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`));

  if (lines.length === 0) return "";

  const intro =
    "The following skills are available. When one is relevant to the user's " +
    "request, call the `skill__load_skill` tool with its name to read its full " +
    "instructions, then follow them. Do not guess a skill's contents — load it.";

  return [intro, ...lines].join("\n");
}
