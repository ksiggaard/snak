// Sidebar/layout UI preferences (T21/T22/T24). Like the theme preference these
// are pure, per-device UI concerns read synchronously at first paint, so they
// live in localStorage (not the SQLite settings table) to avoid a layout flash.
// Mirrors the shape of `src/lib/theme.ts`.

export type SidebarMode = "chats" | "projects" | "bots";

const WIDTH_KEY = "sidebar-width";
const OPEN_KEY = "sidebar-open";
const MODE_KEY = "sidebar-mode";

/** Min/max draggable sidebar width (px). DEFAULT == the original `w-64` (16rem). */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 256;

/** Clamp a raw drag width into [MIN, MAX], rounding to whole px. Non-finite
 *  input falls back to the default so a corrupt value can never break layout. */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)));
}

export function getStoredSidebarWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY);
  if (raw === null) return SIDEBAR_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clampSidebarWidth(n) : SIDEBAR_DEFAULT;
}

export function storeSidebarWidth(px: number): void {
  localStorage.setItem(WIDTH_KEY, String(clampSidebarWidth(px)));
}

export function getStoredSidebarOpen(): boolean {
  // Default open; only an explicit "0" means collapsed.
  return localStorage.getItem(OPEN_KEY) !== "0";
}

export function storeSidebarOpen(open: boolean): void {
  localStorage.setItem(OPEN_KEY, open ? "1" : "0");
}

export function getStoredSidebarMode(): SidebarMode {
  const raw = localStorage.getItem(MODE_KEY);
  return raw === "projects" || raw === "bots" ? raw : "chats";
}

export function storeSidebarMode(mode: SidebarMode): void {
  localStorage.setItem(MODE_KEY, mode);
}
