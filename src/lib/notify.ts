import { invoke } from "@tauri-apps/api/core";
import { WEB_ONLY } from "./webOnly";

/**
 * Show an OS notification that a reply finished. The Rust command no-ops when
 * the main window is focused, so callers can fire it unconditionally on
 * completion. Clicking the notification raises snak and emits `notify-activate`
 * with `threadId` (handled in `App.tsx`).
 */
export async function notifyChatDone(
  threadId: string,
  title: string,
  body: string,
): Promise<void> {
  if (WEB_ONLY) return; // command isn't stubbed in web-only mode
  try {
    await invoke("notify_chat_done", { threadId, title, body });
  } catch {
    // Notifications are best-effort — never let one break a finished reply.
  }
}
