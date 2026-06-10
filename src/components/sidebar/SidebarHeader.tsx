import { BarChart3, MoreVertical, PanelLeftClose, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useView } from "@/store/view";
import { useTheme } from "@/store/theme";
import type { Theme } from "@/lib/theme";

/** Sidebar top bar (T25): app title + a collapse/close toggle (T22) + an
 *  overflow menu housing the chrome that used to live in the chat header —
 *  Settings, Usage, and the theme switch. `onClose` collapses the inline
 *  sidebar (desktop) or dismisses the overlay sheet (narrow). */
export function SidebarHeader({ onClose }: { onClose: () => void }) {
  const setView = useView((s) => s.setView);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  return (
    <div className="flex items-center gap-1 px-2 py-2">
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
        snak
      </h1>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hide sidebar"
            onClick={onClose}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Hide sidebar</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Menu">
            <MoreVertical className="size-4" />
          </Button>
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
    </div>
  );
}
