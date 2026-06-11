import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SHORTCUT, SHORTCUT_KEY } from "@/components/settings/Shortcut";
import { CLOSE_TO_TRAY_KEY } from "@/components/settings/CloseToTray";
import { SettingsView } from "@/components/settings/SettingsView";
import { ChatView } from "@/components/chat/ChatView";
import { ProjectView } from "@/components/projects/ProjectView";
import { UsageView } from "@/components/usage/UsageView";
import { SearchResults } from "@/components/search/SearchResults";
import { Sidebar, SidebarContent } from "@/components/sidebar/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSetting } from "@/lib/db";
import { setGlobalShortcut, type QuickPayload } from "@/lib/quick";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { usePlugins } from "@/store/plugins";
import { useModels } from "@/store/models";
import { useKeys } from "@/store/keys";
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
  const loadKeys = useKeys((s) => s.load);
  const openProjectId = useProjects((s) => s.openProjectId);
  const searchOpen = useSearch((s) => s.open);
  const view = useView((s) => s.view);
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const mobileOpen = useLayout((s) => s.mobileOpen);
  const setMobileOpen = useLayout((s) => s.setMobileOpen);

  useEffect(() => {
    void init();
    void initProjects();
    void loadKeys();
    void loadPlugins();
    void loadInstalledThemes();
    void loadModels();
  }, [init, initProjects, loadKeys, loadPlugins, loadInstalledThemes, loadModels]);

  useEffect(() => {
    getSetting(SHORTCUT_KEY).then((v) => {
      if (v && v !== DEFAULT_SHORTCUT) void setGlobalShortcut(v);
    });
  }, []);

  useEffect(() => {
    getSetting(CLOSE_TO_TRAY_KEY).then((v) => {
      void invoke("set_close_to_tray", {
        enabled: v === null ? true : v === "1",
      });
    });
  }, []);

  useEffect(() => {
    const { startNewChat, send, setProviderModel } = useThreads.getState();
    const unlisten = listen<QuickPayload>("quick-submit", (e) => {
      useProjects.getState().close();
      useView.getState().showChat();
      useLayout.getState().setMobileOpen(false);
      startNewChat();
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
      <div className="bg-background text-foreground flex h-screen flex-col">
        <TitleBar />
        <ConfirmDialog />

        <div className="flex min-h-0 flex-1">
          {/* Inline sidebar (>= md), shown unless collapsed. */}
          {sidebarOpen && <Sidebar />}

          {/* Overlay sidebar for narrow widths. */}
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
      </div>
    </TooltipProvider>
  );
}

export default App;
