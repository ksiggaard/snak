import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { youTubeEmbedSrc, type YouTubeRef } from "@/lib/youtube";

/**
 * Pop a video out into a separate, always-on-top OS window so it keeps playing
 * while the user moves on in the main window. The window loads the
 * youtube-nocookie embed URL directly (a plain remote webview — it calls no
 * Tauri APIs, so it needs no capability of its own); creating it requires
 * `core:webview:allow-create-webview-window` on the calling (main) window.
 *
 * One window per video id: re-popping the same video focuses the existing
 * window instead of opening a duplicate. (The player starts fresh from the
 * URL's start offset rather than the inline player's current position —
 * syncing playback would require the YouTube iframe API.)
 */
export async function popOutVideo(ref: YouTubeRef, title: string): Promise<void> {
  const label = `youtube-${ref.id}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: youTubeEmbedSrc(ref),
    title: title || "YouTube",
    width: 560,
    height: 315,
    minWidth: 320,
    minHeight: 180,
    resizable: true,
    alwaysOnTop: true,
  });
  // Surface creation failures to the console; nothing actionable for the user.
  void win.once("tauri://error", (e) => {
    console.error("pop-out video window failed:", e.payload);
  });
}
