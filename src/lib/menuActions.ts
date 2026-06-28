import { invoke } from "@tauri-apps/api/core";
import { isMac } from "@/lib/titlebar";
import { getSetting } from "@/lib/db";
import { t } from "@/store/i18n";
import { useThreads } from "@/store/threads";
import { useWorkspaces } from "@/store/workspaces";
import { useBots } from "@/store/bots";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";
import { useZoom } from "@/store/zoom";

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
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "focus-composer"
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
  if (!mod || e.altKey || e.isComposing) return null;

  // Zoom — allow Shift (US "+" is Shift+=). Match by key and by numpad code.
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd")
    return "zoom-in";
  if (e.key === "-" || e.code === "NumpadSubtract") return "zoom-out";
  if (e.key === "0" || e.code === "Numpad0") return "zoom-reset";

  if (e.shiftKey) return null;
  switch (e.key.toLowerCase()) {
    case "n":
      return "new-chat";
    case "k":
      return "search";
    case "b":
      return "toggle-sidebar";
    case "l":
      return "focus-composer";
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

/**
 * Markdown cheat sheet of keyboard shortcuts, for the `/help` slash command.
 * Reads the (customizable) global shortcut from settings; the rest are the
 * menu/composer shortcuts handled in `menuActionForKey` and the Composer.
 * ponytail: curated list — shortcuts rarely change; if it drifts from the
 * `menuActionForKey` switch, fold both onto a shared table.
 */
export async function buildShortcutsHelp(): Promise<string> {
  const globalShortcut = (await getSetting("global_shortcut")) ?? "Alt+Space";
  const row = (keys: string, what: string) => `| ${keys} | ${what} |`;
  const lines: string[] = [
    `### ${t("help.title")}`,
    "",
    `| ${t("help.shortcut")} | ${t("help.action")} |`,
    "| --- | --- |",
    row(globalShortcut, t("help.quickInput")),
    row(shortcutLabel("N"), t("help.newChat")),
    row(shortcutLabel("K"), t("help.search")),
    row(shortcutLabel("B"), t("help.toggleSidebar")),
    row(shortcutLabel("L"), t("help.focusComposer")),
    row(shortcutLabel(","), t("help.settings")),
    row(shortcutLabel("U"), t("help.usage")),
    row(shortcutLabel("Q"), t("help.quit")),
    row(
      `${shortcutLabel("+")} / ${shortcutLabel("-")} / ${shortcutLabel("0")}`,
      t("help.zoom"),
    ),
    row("Enter", t("help.send")),
    row("Shift+Enter", t("help.newline")),
    row("/", t("help.commands")),
    row("@", t("help.mentions")),
    row("↑ / ↓", t("help.history")),
    row("Esc", t("help.dismiss")),
  ];
  return lines.join("\n");
}

export function runMenuAction(action: MenuAction): void {
  switch (action) {
    case "new-chat":
      // Same sequence as the sidebar's New Chat button.
      useView.getState().showChat();
      useSearch.getState().clear();
      useWorkspaces.getState().close();
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
    case "settings": {
      // Settings categories live in the standard list pane (sidebarMode
      // "settings"); reveal it and show the settings view on the current
      // category.
      const layout = useLayout.getState();
      layout.setSidebarMode("settings");
      if (layout.tier === "wide") layout.setSidebarOpen(true);
      else layout.setCompactNav(1);
      useView.getState().setView("settings");
      break;
    }
    case "usage":
      useView.getState().setView("usage");
      break;
    case "zoom-in":
      useZoom.getState().zoomIn();
      break;
    case "zoom-out":
      useZoom.getState().zoomOut();
      break;
    case "zoom-reset":
      useZoom.getState().resetZoom();
      break;
    case "focus-composer":
      useThreads.getState().focusComposer();
      break;
    case "quit":
      // Exits outright, bypassing close-to-tray (like the tray's Quit).
      void invoke("quit_app");
      break;
  }
}
