import { invoke } from "@tauri-apps/api/core";

/**
 * Languages whose code blocks get an "Open in terminal" action. The value comes
 * from `languageFromClassName` (already lowercased), so we compare lowercase.
 */
const SHELL_LANGUAGES = new Set(["bash", "sh", "shell", "zsh"]);

/** Whether a (normalized) code-fence language is a shell the terminal action supports. */
export function isShellLanguage(language: string | null | undefined): boolean {
  return language != null && SHELL_LANGUAGES.has(language.toLowerCase());
}

/**
 * Open an OS terminal with `command` staged (pre-typed) but NOT executed — the
 * user must review it and press Enter. The command is passed as data to the
 * backend, never interpolated into a shell string.
 */
export const openInTerminal = (command: string): Promise<void> =>
  invoke("open_in_terminal", { command });
