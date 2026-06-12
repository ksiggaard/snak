// Title bar appearance preferences. Like the theme, these are pure UI concerns
// stored in localStorage so they're read synchronously at startup with no
// flash of the wrong chrome. The actual OS decoration toggle is applied by an
// effect in `App` (the quick-input window must never gain decorations, so the
// store itself doesn't touch the window).

/** OS-native title bar vs. the app's own compact one. */
export type TitleBarMode = "custom" | "native";
/** Which end of the custom bar holds the window-control buttons. */
export type ControlsSide = "left" | "right";
/** Visual style of the custom window controls. */
export type ControlsStyle = "windows" | "macos" | "gnome";
/**
 * Where the application menu shows (Linux/Windows; macOS always uses the
 * system menu bar):
 * - `native`  — the OS menubar widget, exported to KDE's global menu when the
 *   `appmenu-gtk-module` is installed (otherwise drawn above the title bar).
 * - `inline`  — native widget hidden; the in-app `MenuBar` renders beneath the
 *   title bar instead.
 * - `hidden`  — no visible menu (the menu stays installed, so a global-menu
 *   panel can still pick it up).
 */
export type MenuBarMode = "native" | "inline" | "hidden";

const MODE_KEY = "titlebar-mode";
const SIDE_KEY = "titlebar-side";
const STYLE_KEY = "titlebar-style";
const MENUBAR_KEY = "menubar-mode";

export const isMac = navigator.userAgent.includes("Mac OS X");

export function getStoredTitleBarMode(): TitleBarMode {
  const v = localStorage.getItem(MODE_KEY);
  return v === "native" || v === "custom" ? v : "custom";
}

export function storeTitleBarMode(mode: TitleBarMode): void {
  localStorage.setItem(MODE_KEY, mode);
}

export function getStoredControlsSide(): ControlsSide {
  const v = localStorage.getItem(SIDE_KEY);
  if (v === "left" || v === "right") return v;
  return isMac ? "left" : "right";
}

export function storeControlsSide(side: ControlsSide): void {
  localStorage.setItem(SIDE_KEY, side);
}

export function getStoredControlsStyle(): ControlsStyle {
  const v = localStorage.getItem(STYLE_KEY);
  if (v === "windows" || v === "macos" || v === "gnome") return v;
  return isMac ? "macos" : "windows";
}

export function storeControlsStyle(style: ControlsStyle): void {
  localStorage.setItem(STYLE_KEY, style);
}

export function getStoredMenuBarMode(): MenuBarMode {
  const v = localStorage.getItem(MENUBAR_KEY);
  return v === "native" || v === "inline" || v === "hidden" ? v : "native";
}

export function storeMenuBarMode(mode: MenuBarMode): void {
  localStorage.setItem(MENUBAR_KEY, mode);
}
