// T15 skills support.
//
// A "skill" is a packaged set of instructions surfaced to the model. It is just
// a `skill`-category plugin from the T12 host: its manifest's
// `contributes.skill = { name, instructions }` descriptor. We consume the
// host registry (`buildRegistry(...).skills` via `selectRegistry`/`usePlugins`)
// rather than touching plugin internals — enabling/disabling a skill is the
// existing plugin enable/disable, so no new state or commands are needed.
//
// Enabled skills are injected into the leading system context. They sit
// *alongside* the global guidance (T10) and ahead of project context (T20), so
// the model treats them as standing capabilities. The composition is a pure
// function so it can be unit-tested in isolation and wired into
// `store/threads.ts` `send()` with a single additive line.

import type { SkillContribution } from "@/types/plugins";

/**
 * Build the system text describing the enabled skills. Each skill becomes a
 * labeled block (`## <name>` + its instructions) under a short header.
 *
 * Returns an empty string when there are no skills with usable content — so
 * callers skip adding a system message and existing chats are unaffected when
 * no skills are enabled. Skills whose name and instructions are both blank are
 * dropped; blank fields within an otherwise-present skill are tolerated.
 */
export function buildSkillsSystemText(skills: SkillContribution[]): string {
  const blocks = skills
    .map((s) => ({
      name: (s.name ?? "").trim(),
      instructions: (s.instructions ?? "").trim(),
    }))
    .filter((s) => s.name !== "" || s.instructions !== "")
    .map((s) => {
      const heading = s.name ? `## ${s.name}` : "## Skill";
      return s.instructions ? `${heading}\n${s.instructions}` : heading;
    });

  if (blocks.length === 0) return "";

  const intro =
    "The following skills are available to you. Apply the relevant ones when " +
    "they help with the user's request:";

  return [intro, ...blocks].join("\n\n");
}
