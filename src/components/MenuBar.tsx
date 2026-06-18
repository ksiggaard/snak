import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  runMenuAction,
  shortcutLabel,
  type MenuAction,
} from "@/lib/menuActions";
import { useT } from "@/store/i18n";

/**
 * In-app application menu bar, rendered beneath the TitleBar when the "menu
 * bar" Appearance setting is "Below title bar" (`inline`). It mirrors the
 * native menu built in `src-tauri/src/menu.rs` — same File/View structure,
 * same actions via `runMenuAction` — for setups without a global-menu panel
 * (e.g. KDE without `appmenu-gtk-module`), where the native menubar would
 * otherwise be drawn above the custom title bar.
 */
export function MenuBar() {
  const t = useT();
  return (
    <div className="bg-background text-foreground border-border flex h-7 shrink-0 select-none items-center gap-0.5 border-b px-1.5">
      <Menu label={t("menu.file")}>
        <Item action="new-chat" shortcut="N">
          {t("menu.newChat")}
        </Item>
        <DropdownMenuSeparator />
        <Item action="settings" shortcut=",">
          {t("menu.settings")}
        </Item>
        <DropdownMenuSeparator />
        <Item action="quit" shortcut="Q">
          {t("menu.quit")}
        </Item>
      </Menu>
      <Menu label={t("menu.view")}>
        <Item action="search" shortcut="K">
          {t("menu.searchChats")}
        </Item>
        <Item action="toggle-sidebar" shortcut="B">
          {t("menu.toggleSidebar")}
        </Item>
        <Item action="focus-composer" shortcut="L">
          {t("menu.focusInput")}
        </Item>
        <DropdownMenuSeparator />
        <Item action="usage" shortcut="U">
          {t("menu.usage")}
        </Item>
        <DropdownMenuSeparator />
        <Item action="zoom-in" shortcut="+">
          {t("menu.zoomIn")}
        </Item>
        <Item action="zoom-out" shortcut="-">
          {t("menu.zoomOut")}
        </Item>
        <Item action="zoom-reset" shortcut="0">
          {t("menu.resetZoom")}
        </Item>
      </Menu>
    </div>
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="text-foreground/80 hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground rounded px-2 py-0.5 text-[13px] transition-colors">
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({
  action,
  shortcut,
  children,
}: {
  action: MenuAction;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem onClick={() => runMenuAction(action)}>
      {children}
      {shortcut && (
        <DropdownMenuShortcut>{shortcutLabel(shortcut)}</DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  );
}
