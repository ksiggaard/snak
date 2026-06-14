import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Open a URL in the OS default browser via the Tauri opener plugin.
 *
 * In a Tauri webview a plain `<a target="_blank">` is unreliable — it may be
 * swallowed or try to navigate the app window itself — so every user-facing
 * link (chat markdown, web-source citations, image sources) routes its click
 * through here. Best-effort: a failed OS open is swallowed rather than thrown,
 * since there's nothing actionable to surface for a dead/blocked URL.
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  try {
    await openUrl(url);
  } catch {
    // ignore — opening externally is best-effort
  }
}
