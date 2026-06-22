import { Cog, Minus, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { runMenuAction, shortcutLabel } from "@/lib/menuActions";
import { useZoom } from "@/store/zoom";
import { useConnectivity } from "@/store/connectivity";
import { useT } from "@/store/i18n";

/** The "Manage" menu — relocated from the old TitleBar "⋯" dropdown. Usage, a
 *  browser-style zoom row, and the Work-offline toggle. Settings is its own
 *  rail section now; theme moved to Settings › Appearance. */
export function ManageMenu() {
  const t = useT();
  const zoom = useZoom((s) => s.zoom);
  const zoomIn = useZoom((s) => s.zoomIn);
  const zoomOut = useZoom((s) => s.zoomOut);
  const resetZoom = useZoom((s) => s.resetZoom);
  const forceOffline = useConnectivity((s) => s.forceOffline);
  const setForceOffline = useConnectivity((s) => s.setForceOffline);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t("rail.manage")}
              className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground flex size-9 items-center justify-center rounded-lg transition-colors"
            >
              <Cog className="size-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t("rail.manage")}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuItem onClick={() => runMenuAction("usage")}>
          {t("titleBar.usage")}
          <DropdownMenuShortcut>{shortcutLabel("U")}</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Zoom row — plain buttons (not menu items) so the menu stays open
            across repeated clicks. */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm">{t("manage.zoom")}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              aria-label={t("menu.zoomOut")}
              className="hover:bg-accent flex size-6 items-center justify-center rounded"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="w-10 text-center text-xs tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={zoomIn}
              aria-label={t("menu.zoomIn")}
              className="hover:bg-accent flex size-6 items-center justify-center rounded"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
        <DropdownMenuItem onClick={resetZoom}>
          {t("menu.resetZoom")}
          <DropdownMenuShortcut>{shortcutLabel("0")}</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={forceOffline === true}
          onCheckedChange={(v) => void setForceOffline(v === true)}
        >
          {t("titleBar.workOffline")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
