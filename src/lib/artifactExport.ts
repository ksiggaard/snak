// Frontend wrappers for the artifact export/open Rust commands. Kept separate
// from the pure `src/lib/artifacts.ts` so the parser/assembler stay free of
// Tauri imports (and unit-testable in plain Node).

import { invoke } from "@tauri-apps/api/core";
import type { ArtifactFile } from "@/types/db";

/** Save the artifact's files to a user-chosen `.zip`. Resolves `false` if the
 * user cancelled the save dialog. */
export function exportArtifactZip(
  files: ArtifactFile[],
  suggestedName: string,
): Promise<boolean> {
  return invoke<boolean>("export_artifact_zip", {
    files,
    suggestedName,
  });
}

/** Write the assembled HTML to a temp file and open it in the system browser. */
export function openArtifactInBrowser(html: string): Promise<void> {
  return invoke("open_artifact_in_browser", { html });
}
