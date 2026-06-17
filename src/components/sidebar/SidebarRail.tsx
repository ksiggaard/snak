import { Bot, Folder, MessagesSquare, type LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ManageMenu } from "./ManageMenu";
import { useLayout } from "@/store/layout";
import { useT, type MessageKey } from "@/store/i18n";
import type { SidebarMode } from "@/lib/layout";
import { cn } from "@/lib/utils";

interface SidebarSection {
  id: SidebarMode;
  labelKey: MessageKey;
  Icon: LucideIcon;
}

// Single source of truth for rail entries. Adding a section is a one-line edit
// here; a future plugin "view" category would extend this list (see spec).
const SECTIONS: SidebarSection[] = [
  { id: "chats", labelKey: "sidebar.chats", Icon: MessagesSquare },
  { id: "projects", labelKey: "sidebar.workspaces", Icon: Folder },
  { id: "bots", labelKey: "sidebar.bots", Icon: Bot },
];

/** Vertical, fully left-aligned icon rail (VS Code / Teams activity bar). Top
 *  group switches the list-pane section; the bottom holds the Manage (cog)
 *  menu. `variant="overlay"` is used inside the compact Sheet. */
export function SidebarRail({
  variant = "inline",
}: {
  variant?: "inline" | "overlay";
}) {
  const t = useT();
  const mode = useLayout((s) => s.sidebarMode);
  const setMode = useLayout((s) => s.setSidebarMode);
  const tier = useLayout((s) => s.tier);
  const setSidebarOpen = useLayout((s) => s.setSidebarOpen);
  const compactNav = useLayout((s) => s.compactNav);
  const setCompactNav = useLayout((s) => s.setCompactNav);

  const onSelect = (id: SidebarMode) => {
    setMode(id);
    // Ensure the list pane is visible (mode switch alone doesn't open it).
    if (tier === "wide") setSidebarOpen(true);
    else if (compactNav < 1) setCompactNav(1);
  };

  return (
    <nav
      aria-label={t("sidebar.navigation")}
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border flex w-12 shrink-0 flex-col items-center border-r py-2",
        variant === "overlay" && "z-20 shadow-lg",
      )}
    >
      <div className="flex flex-col items-center gap-1">
        {SECTIONS.map(({ id, labelKey, Icon }) => {
          const active = mode === id;
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelect(id)}
                  aria-label={t(labelKey)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex size-9 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  )}
                >
                  {active && (
                    <span className="bg-primary absolute top-1.5 bottom-1.5 -left-2 w-0.5 rounded-full" />
                  )}
                  <Icon className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t(labelKey)}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex-1" />

      <ManageMenu />
    </nav>
  );
}
