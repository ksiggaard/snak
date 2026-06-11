import { getCurrentWindow } from "@tauri-apps/api/window";
import { BarChart3, Menu, Minus, MoreVertical, PanelLeft, PanelLeftClose, Settings2, Square, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLayout } from "@/store/layout";
import { useView } from "@/store/view";
import { useTheme } from "@/store/theme";
import type { Theme } from "@/lib/theme";

const isMac = navigator.userAgent.includes("Mac OS X");

export function TitleBar() {
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const toggleSidebar = useLayout((s) => s.toggleSidebar);
  const setMobileOpen = useLayout((s) => s.setMobileOpen);
  const setView = useView((s) => s.setView);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  const win = getCurrentWindow();

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-8 shrink-0 select-none items-center">

      {/* Logo + app name */}
      <div data-tauri-drag-region className="flex items-center gap-1.5 px-2">
        <img src="/icon.png" className="size-4 rounded-sm" draggable={false} />
        <span className="text-sidebar-foreground/80 text-[13px] font-semibold tracking-tight">
          snak
        </span>
      </div>

      {/* Sidebar toggle — PanelLeftClose when open, hamburger on mobile, PanelLeft when collapsed */}
      <div className="flex items-center">
        {/* Mobile hamburger (< md) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setMobileOpen(true)}
              className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-8 items-center justify-center transition-colors md:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open sidebar</TooltipContent>
        </Tooltip>

        {/* Desktop toggle (>= md) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSidebar}
              className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground hidden h-8 w-8 items-center justify-center transition-colors md:flex"
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {sidebarOpen
                ? <PanelLeftClose className="size-3.5" />
                : <PanelLeft className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Drag region fills remaining space */}
      <div data-tauri-drag-region className="min-w-0 flex-1 self-stretch" />

      {/* Menu dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-8 items-center justify-center transition-colors"
            aria-label="Menu"
          >
            <MoreVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setView("settings")}>
            <Settings2 className="size-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setView("usage")}>
            <BarChart3 className="size-4" />
            Usage
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(v) => setTheme(v as Theme)}
          >
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Window controls — hidden on macOS (traffic lights) */}
      {!isMac && (
        <div className="flex items-center">
          <button
            onClick={() => void win.minimize()}
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-9 items-center justify-center transition-colors"
            aria-label="Minimize"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            onClick={() => void win.toggleMaximize()}
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-9 items-center justify-center transition-colors"
            aria-label="Maximize"
          >
            <Square className="size-3" />
          </button>
          <button
            onClick={() => void win.close()}
            className="text-sidebar-foreground/60 hover:text-sidebar-foreground flex h-8 w-9 items-center justify-center transition-colors hover:bg-red-500/80 hover:!text-white"
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
