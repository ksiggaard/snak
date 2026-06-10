import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Menu, PanelLeft } from "lucide-react";
import { DEFAULT_SHORTCUT, SHORTCUT_KEY } from "@/components/settings/Shortcut";
import { CLOSE_TO_TRAY_KEY } from "@/components/settings/CloseToTray";
import { SettingsView } from "@/components/settings/SettingsView";
import { ChatView } from "@/components/chat/ChatView";
import { ProjectView } from "@/components/projects/ProjectView";
import { UsageView } from "@/components/usage/UsageView";
import { SearchResults } from "@/components/search/SearchResults";
import { Sidebar, SidebarContent } from "@/components/sidebar/Sidebar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getSetting } from "@/lib/db";
import { cn } from "@/lib/utils";
import { setGlobalShortcut, type QuickPayload } from "@/lib/quick";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { usePlugins } from "@/store/plugins";
import { useModels } from "@/store/models";
import { useSearch } from "@/store/search";
import { useTheme } from "@/store/theme";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";

function App() {
  const init = useThreads((s) => s.init);
  const initProjects = useProjects((s) => s.init);
  const loadPlugins = usePlugins((s) => s.load);
  const loadInstalledThemes = useTheme((s) => s.loadInstalled);
  const loadModels = useModels((s) => s.load);
  const openProjectId = useProjects((s) => s.openProjectId);
  const searchOpen = useSearch((s) => s.open);
  const view = useView((s) => s.view);
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const toggleSidebar = useLayout((s) => s.toggleSidebar);
  // Narrow-width overlay sidebar (T21) — transient, separate from the persisted
  // desktop collapse state so it never auto-opens over a small chat column.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    void init();
    void initProjects();
    // Load the plugin registry app-wide (T18) so the active provider list is
    // correct on first paint — ModelPicker / ApiKeys / send-gating all read it.
    void loadPlugins();
    // Re-apply the saved installable theme (T11) on startup. The themes folder
    // is the authoritative source here; plugin-contributed themes are composed
    // in the Themes settings card when it mounts.
    void loadInstalledThemes();
    void loadModels();
  }, [init, initProjects, loadPlugins, loadInstalledThemes, loadModels]);

  // Apply the user's saved global shortcut (Rust registers the default already).
  useEffect(() => {
    getSetting(SHORTCUT_KEY).then((v) => {
      if (v && v !== DEFAULT_SHORTCUT) void setGlobalShortcut(v);
    });
  }, []);

  // Sync the persisted close-to-tray preference into Rust managed state (which
  // defaults to ON) so the window-close handler honours a saved "off".
  useEffect(() => {
    getSetting(CLOSE_TO_TRAY_KEY).then((v) => {
      void invoke("set_close_to_tray", {
        enabled: v === null ? true : v === "1",
      });
    });
  }, []);

  // Quick-input overlay submissions start a new thread in this (main) window.
  useEffect(() => {
    const { startNewChat, send, setProviderModel } = useThreads.getState();
    const unlisten = listen<QuickPayload>("quick-submit", (e) => {
      useProjects.getState().close();
      useView.getState().showChat();
      setMobileOpen(false);
      startNewChat();
      // Apply the model chosen in the overlay to the fresh draft (set
      // synchronously when there's no current thread) so the new thread uses it.
      if (e.payload.provider && e.payload.model) {
        void setProviderModel(e.payload.provider, e.payload.model);
      }
      void send(e.payload.text, e.payload.images);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-background text-foreground flex h-screen">
        <ConfirmDialog />

        {/* Inline sidebar (>= md), shown unless collapsed (T22). */}
        {sidebarOpen && <Sidebar />}

        {/* Overlay sidebar for narrow widths (T21). */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="bg-sidebar text-sidebar-foreground gap-0 p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="flex min-w-0 flex-1 flex-col p-3 md:p-4">
          {/* Slim toggle bar — only takes space when there's no inline sidebar
              to reach: always on narrow widths (hamburger → overlay), and on
              desktop only while collapsed (reopen). Hidden on desktop when the
              sidebar is shown, so the chat keeps the reclaimed height (T25). */}
          <div
            className={cn(
              "mb-2 flex items-center gap-2",
              sidebarOpen && "md:hidden",
            )}
          >
            <Button
              variant="outline"
              size="icon"
              aria-label="Open sidebar"
              onClick={() => setMobileOpen(true)}
              className="md:hidden"
            >
              <Menu className="size-4" />
            </Button>
            {!sidebarOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Show sidebar"
                    onClick={toggleSidebar}
                    className="hidden md:flex"
                  >
                    <PanelLeft className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Show sidebar</TooltipContent>
              </Tooltip>
            )}
          </div>

          {view === "settings" ? (
            <SettingsView />
          ) : view === "usage" ? (
            <UsageView />
          ) : searchOpen ? (
            <SearchResults />
          ) : openProjectId ? (
            <ProjectView />
          ) : (
            <ChatView />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

export default App;
