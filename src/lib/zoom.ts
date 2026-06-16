// Browser-style page zoom (Ctrl/Cmd +/-/0). Like the theme/layout prefs this is
// a per-device UI concern read synchronously at startup, so it lives in
// localStorage (not the SQLite settings table). Distinct from the Typography
// "UI size" setting: zoom scales the whole webview (text, images, spacing) via
// Tauri's per-webview setZoom, not just the root font-size.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

const KEY = "zoom";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1.0;

/** Clamp to [MIN, MAX] and snap to one decimal; non-finite → default. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT;
  const snapped = Math.round(z * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

export function getStoredZoom(): number {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return ZOOM_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clampZoom(n) : ZOOM_DEFAULT;
}

export function storeZoom(z: number): void {
  const v = clampZoom(z);
  if (v === ZOOM_DEFAULT) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, String(v));
}

/** Apply the zoom to the current webview. No-op in the quick-input overlay
 *  (a separate window that must stay at 100%). */
export function applyZoom(z: number): void {
  if (getCurrentWindow().label === "quick") return;
  void getCurrentWebview().setZoom(clampZoom(z));
}
