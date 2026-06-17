import type { Workspace, WorkspaceFile } from "@/types/db";

/**
 * Maximum number of characters of assembled workspace context to inject into a
 * request. Guards against large workspace files blowing the context window.
 * Files are included in order until this budget is reached; an overflowing file
 * is truncated and any remaining files are dropped with a note.
 *
 * 100k chars is a deliberately rough heuristic (~25-30k tokens) that leaves
 * ample room for history + the model's reply across all supported providers.
 */
export const WORKSPACE_CONTEXT_CHAR_BUDGET = 100_000;

const TRUNCATION_MARKER = "\n…[truncated to fit the context budget]";

/**
 * Build the system-context text injected for a thread that belongs to a
 * workspace: the workspace instructions followed by its reference files, each
 * in a labeled block. Phrased as *context* (not commands) and intended to be
 * ordered before the conversation history.
 *
 * Returns an empty string when there is nothing to inject (no instructions and
 * no files) — callers should skip adding a system message in that case.
 *
 * Composability: T10 (global / per-thread system prompt) can prepend or append
 * its own text around this block to realize the global → workspace → thread
 * precedence; this function only owns the workspace layer.
 */
export function buildWorkspaceSystemText(
  workspace: Pick<Workspace, "name" | "instructions">,
  files: Pick<WorkspaceFile, "name" | "content">[],
  charBudget: number = WORKSPACE_CONTEXT_CHAR_BUDGET,
): string {
  const sections: string[] = [];

  const name = workspace.name.trim();
  const instructions = workspace.instructions.trim();

  const header = name ? `Workspace: ${name}` : "Workspace context";
  if (instructions) {
    sections.push(`${header}\n\n${instructions}`);
  } else if (files.length > 0) {
    sections.push(header);
  }

  if (files.length === 0) {
    return sections.join("\n\n");
  }

  const intro =
    "The following workspace files are provided as reference context:";
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

/** Total character size of a workspace's files (for the size meter / warnings). */
export function workspaceFilesSize(
  files: Pick<WorkspaceFile, "content">[],
): number {
  return files.reduce((sum, f) => sum + f.content.length, 0);
}

/**
 * Filter a list of workspace files by removing those whose id is in the
 * `excludedIds` set.
 *
 * The "store excluded" model (T61): only de-selected ids are stored — NULL or
 * an empty array means nothing is excluded (all files included). A file added
 * to the workspace later is automatically included because its id is not in the
 * stored excluded set.
 *
 * @param files     The full list of workspace files.
 * @param excludedIds  Ids to exclude; null/undefined/[] → include all.
 */
export function filterWorkspaceFiles<T extends { id: string }>(
  files: T[],
  excludedIds: string[] | null | undefined,
): T[] {
  if (!excludedIds || excludedIds.length === 0) return files;
  const excluded = new Set(excludedIds);
  return files.filter((f) => !excluded.has(f.id));
}
