import type { Project, ProjectFile } from "@/types/db";

/**
 * Maximum number of characters of assembled project context to inject into a
 * request. Guards against large project files blowing the context window.
 * Files are included in order until this budget is reached; an overflowing file
 * is truncated and any remaining files are dropped with a note.
 *
 * 100k chars is a deliberately rough heuristic (~25-30k tokens) that leaves
 * ample room for history + the model's reply across all supported providers.
 */
export const PROJECT_CONTEXT_CHAR_BUDGET = 100_000;

const TRUNCATION_MARKER = "\n…[truncated to fit the context budget]";

/**
 * Build the system-context text injected for a thread that belongs to a
 * project: the project instructions followed by its reference files, each in a
 * labeled block. Phrased as *context* (not commands) and intended to be ordered
 * before the conversation history.
 *
 * Returns an empty string when there is nothing to inject (no instructions and
 * no files) — callers should skip adding a system message in that case.
 *
 * Composability: T10 (global / per-thread system prompt) can prepend or append
 * its own text around this block to realize the global → project → thread
 * precedence; this function only owns the project layer.
 */
export function buildProjectSystemText(
  project: Pick<Project, "name" | "instructions">,
  files: Pick<ProjectFile, "name" | "content">[],
  charBudget: number = PROJECT_CONTEXT_CHAR_BUDGET,
): string {
  const sections: string[] = [];

  const name = project.name.trim();
  const instructions = project.instructions.trim();

  const header = name ? `Project: ${name}` : "Project context";
  if (instructions) {
    sections.push(`${header}\n\n${instructions}`);
  } else if (files.length > 0) {
    sections.push(header);
  }

  if (files.length === 0) {
    return sections.join("\n\n");
  }

  const intro =
    "The following project files are provided as reference context:";
  let assembled = sections.join("\n\n");
  assembled = assembled ? `${assembled}\n\n${intro}` : intro;

  let droppedFiles = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const block = `\n\n--- ${file.name} ---\n${file.content}`;
    const remaining = charBudget - assembled.length;

    if (remaining <= 0) {
      droppedFiles = files.length - i;
      break;
    }
    if (block.length <= remaining) {
      assembled += block;
    } else {
      // Truncate this file's block to what fits, then stop.
      assembled += block.slice(0, remaining) + TRUNCATION_MARKER;
      droppedFiles = files.length - i - 1;
      break;
    }
  }

  if (droppedFiles > 0) {
    assembled += `\n\n[${droppedFiles} more file${
      droppedFiles === 1 ? "" : "s"
    } omitted to fit the context budget]`;
  }

  return assembled;
}

/** Total character size of a project's files (for the size meter / warnings). */
export function projectFilesSize(
  files: Pick<ProjectFile, "content">[],
): number {
  return files.reduce((sum, f) => sum + f.content.length, 0);
}
