import { invoke } from "@tauri-apps/api/core";

/**
 * Whether inline media playback works in the webview (see the Rust
 * `media_playback_available` command). On Linux this reflects whether the
 * GStreamer `autoaudiosink` element is present; without it, mounting a video
 * crashes the WebKitWebProcess, so callers (the YouTube embed) fall back to
 * opening the video in the system browser.
 *
 * Probed once and cached for the session. On error we conservatively report
 * `false` — the cost of a false negative is "opens in browser" (mild); the cost
 * of a false positive is a webview crash (severe), so we bias to safety.
 */
let cached: Promise<boolean> | null = null;

export function mediaPlaybackAvailable(): Promise<boolean> {
  if (!cached) {
    cached = invoke<boolean>("media_playback_available").catch(() => false);
  }
  return cached;
}
