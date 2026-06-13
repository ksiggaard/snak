import { invoke } from "@tauri-apps/api/core";
import { isMac } from "@/lib/titlebar";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { useBots } from "@/store/bots";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";

/**
 * Application-menu actions, shared by the native menu (Rust emits the action
 * string over the `app-menu` event — see `src-tauri/src/menu.rs` and the
 * listener in `App.tsx`) and the in-app `MenuBar` fallback. Keep the two menus
 * in sync by routing both through here.
 */
export type MenuAction =
  | "new-chat"
  | "search"
  | "toggle-sidebar"
  | "settings"
  | "usage"
  | "quit";

/**
 * Map a keydown to its menu action, or null. Handled in the webview (keydown
 * effect in `App.tsx`) so shortcuts work in every menu-bar mode — the native
 * menu's GTK accelerators only fire while its menubar widget is visible. The
 * two layers can't double-fire: whichever consumes the key event stops the
 * other. Keep this table in sync with the accelerators in
 * `src-tauri/src/menu.rs`.
 */
export function menuActionForKey(e: KeyboardEvent): MenuAction | null {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey || e.shiftKey || e.isComposing) return null;
  switch (e.key.toLowerCase()) {
    case "n":
      return "new-chat";
    case "k":
      return "search";
    case "b":
      return "toggle-sidebar";
    case ",":
      return "settings";
    case "u":
      return "usage";
    case "q":
      return "quit";
    default:
      return null;
  }
}

/** Display label for a shortcut, e.g. `shortcutLabel("N")` → "Ctrl+N" / "⌘N". */
export function shortcutLabel(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}

export function runMenuAction(action: MenuAction): void {
  switch (action) {
    case "new-chat":
      // Same sequence as the sidebar's New Chat button.
      useView.getState().showChat();
      useSearch.getState().clear();
      useProjects.getState().close();
      useBots.getState().close();
      useThreads.getState().startNewChat();
      break;
    case "search": {
      // Toggle the top-center search overlay (so Ctrl+K both opens and
      // dismisses it).
      const s = useSearch.getState();
      if (s.overlayOpen) s.closeOverlay();
      else s.openOverlay();
      break;
    }
    case "toggle-sidebar":
      useLayout.getState().toggleSidebar();
      break;
    case "settings":
      useView.getState().setView("settings");
      break;
    case "usage":
      useView.getState().setView("usage");
      break;
    case "quit":
      // Exits outright, bypassing close-to-tray (like the tray's Quit).
      void invoke("quit_app");
      break;
  }
}
