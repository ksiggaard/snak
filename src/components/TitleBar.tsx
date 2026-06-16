import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Minus,
  PanelLeft,
  PanelLeftClose,
  Search,
  Square,
  WifiOff,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayout } from "@/store/layout";
import { useTitleBar } from "@/store/titlebar";
import { useConnectivity, useIsOffline } from "@/store/connectivity";
import { useT } from "@/store/i18n";
import { runMenuAction, shortcutLabel } from "@/lib/menuActions";
import type { ControlsStyle } from "@/lib/titlebar";

export function TitleBar() {
  const t = useT();
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const tier = useLayout((s) => s.tier);
  const toggleSidebar = useLayout((s) => s.toggleSidebar);
  const barMode = useTitleBar((s) => s.mode);
  const controlsSide = useTitleBar((s) => s.side);
  const controlsStyle = useTitleBar((s) => s.style);
  const offline = useIsOffline();
  const forceOffline = useConnectivity((s) => s.forceOffline);
  const refreshConnectivity = useConnectivity((s) => s.refresh);

  // In native mode the OS draws the window controls; the bar keeps only the
  // app-specific affordances (sidebar toggle, search).
  const showControls = barMode === "custom";

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-8 shrink-0 select-none items-center">
      {showControls && controlsSide === "left" && (
        <WindowControls style={controlsStyle} />
      )}

      {/* Logo + app name */}
      <div data-tauri-drag-region className="flex items-center gap-1.5 px-2">
        <img src="/icon.png" className="size-4 rounded-sm" draggable={false} />
        <span className="text-sidebar-foreground/80 text-[13px] font-semibold tracking-tight">
          snak
        </span>
      </div>

      {/* Sidebar toggle — collapses the pane (wide) or cycles the 3-step
          compact disclosure (<600px). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleSidebar}
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-8 items-center justify-center transition-colors"
            aria-label={
              sidebarOpen
                ? t("titleBar.hideSidebar")
                : t("titleBar.showSidebar")
            }
          >
            {tier === "wide" && sidebarOpen ? (
              <PanelLeftClose className="size-3.5" />
            ) : (
              <PanelLeft className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {sidebarOpen ? t("titleBar.hideSidebar") : t("titleBar.showSidebar")}
        </TooltipContent>
      </Tooltip>

      {/* Search — moved to the left cluster. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => runMenuAction("search")}
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-8 items-center justify-center transition-colors"
            aria-label={t("titleBar.searchChats")}
          >
            <Search className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("titleBar.searchChats")} ({shortcutLabel("K")})
        </TooltipContent>
      </Tooltip>

      {/* Drag region fills remaining space */}
      <div data-tauri-drag-region className="min-w-0 flex-1 self-stretch" />

      {/* Offline badge — visible only when offline (auto-detected or forced).
          Clicking re-probes connectivity. */}
      {offline && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => void refreshConnectivity()}
              className="text-amber-600 hover:bg-sidebar-accent dark:text-amber-500 mr-1 flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors"
              aria-label={t("titleBar.offline")}
            >
              <WifiOff className="size-3" />
              {t("titleBar.offline")}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {forceOffline
              ? t("titleBar.offlineForcedHint")
              : t("titleBar.offlineHint")}
          </TooltipContent>
        </Tooltip>
      )}

      {showControls && controlsSide === "right" && (
        <WindowControls style={controlsStyle} />
      )}
    </div>
  );
}

/** Custom window-control buttons in the selected visual style. */
function WindowControls({ style }: { style: ControlsStyle }) {
  const t = useT();
  const win = getCurrentWindow();
  const minimize = () => void win.minimize();
  const maximize = () => void win.toggleMaximize();
  const close = () => void win.close();

  if (style === "macos") {
    // Traffic lights: close/minimize/zoom circles; glyphs appear on hover of
    // the cluster, like real macOS.
    return (
      <div className="group flex items-center gap-2 px-3">
        <TrafficLight
          color="bg-[#ff5f57]"
          onClick={close}
          label={t("titleBar.close")}
          glyph="×"
        />
        <TrafficLight
          color="bg-[#febc2e]"
          onClick={minimize}
          label={t("titleBar.minimize")}
          glyph="−"
        />
        <TrafficLight
          color="bg-[#28c840]"
          onClick={maximize}
          label={t("titleBar.maximize")}
          glyph="+"
        />
      </div>
    );
  }

  if (style === "gnome") {
    // Adwaita-style circular buttons with a subtle filled background.
    return (
      <div className="flex items-center gap-1.5 px-2">
        <CircleButton onClick={minimize} label={t("titleBar.minimize")}>
          <Minus className="size-3" />
        </CircleButton>
        <CircleButton onClick={maximize} label={t("titleBar.maximize")}>
          <Square className="size-2.5" />
        </CircleButton>
        <CircleButton onClick={close} label={t("titleBar.close")} danger>
          <X className="size-3" />
        </CircleButton>
      </div>
    );
  }

  // Windows: full-height rectangular hover targets, red close.
  return (
    <div className="flex items-center">
      <button
        onClick={minimize}
        className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-9 items-center justify-center transition-colors"
        aria-label={t("titleBar.minimize")}
      >
        <Minus className="size-3.5" />
      </button>
      <button
        onClick={maximize}
        className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 w-9 items-center justify-center transition-colors"
        aria-label={t("titleBar.maximize")}
      >
        <Square className="size-3" />
      </button>
      <button
        onClick={close}
        className="text-sidebar-foreground/60 hover:text-sidebar-foreground flex h-8 w-9 items-center justify-center transition-colors hover:bg-red-500/80 hover:!text-white"
        aria-label={t("titleBar.close")}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function TrafficLight({
  color,
  glyph,
  label,
  onClick,
}: {
  color: string;
  glyph: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex size-3 items-center justify-center rounded-full ${color}`}
      aria-label={label}
    >
      <span className="text-[9px] leading-none font-bold text-transparent group-hover:text-black/60">
        {glyph}
      </span>
    </button>
  );
}

function CircleButton({
  children,
  label,
  danger,
  onClick,
}: {
  children: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground flex size-5 items-center justify-center rounded-full transition-colors ${
        danger
          ? "hover:bg-red-500/80 hover:!text-white"
          : "hover:bg-sidebar-accent/70"
      }`}
      aria-label={label}
    >
      {children}
    </button>
  );
}
