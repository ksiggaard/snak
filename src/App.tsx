import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SHORTCUT, SHORTCUT_KEY } from "@/components/settings/Shortcut";
import { CLOSE_TO_TRAY_KEY } from "@/components/settings/CloseToTray";
import { SettingsView } from "@/components/settings/SettingsView";
import { ChatView } from "@/components/chat/ChatView";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { ProjectView } from "@/components/projects/ProjectView";
import { UsageView } from "@/components/usage/UsageView";
import { SearchResults } from "@/components/search/SearchResults";
import { ThreadList } from "@/components/sidebar/ThreadList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getSetting } from "@/lib/db";
import { setGlobalShortcut, type QuickPayload } from "@/lib/quick";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { usePlugins } from "@/store/plugins";
import { useModels } from "@/store/models";
import { useSearch } from "@/store/search";
import { useTheme } from "@/store/theme";

function App() {
  const init = useThreads((s) => s.init);
  const initProjects = useProjects((s) => s.init);
  const loadPlugins = usePlugins((s) => s.load);
  const loadInstalledThemes = useTheme((s) => s.loadInstalled);
  const loadModels = useModels((s) => s.load);
  const openProjectId = useProjects((s) => s.openProjectId);
  const closeProject = useProjects((s) => s.close);
  const searchOpen = useSearch((s) => s.open);
  const [showSettings, setShowSettings] = useState(false);
  const [showUsage, setShowUsage] = useState(false);

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
    const { startNewChat, send } = useThreads.getState();
    const unlisten = listen<QuickPayload>("quick-submit", (e) => {
      useProjects.getState().close();
      startNewChat();
      void send(e.payload.text, e.payload.images);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="bg-background text-foreground flex h-screen">
      <ConfirmDialog />
      <ThreadList />

      <main className="flex flex-1 flex-col gap-3 p-4">
        <header className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">snak</h1>
          {!showSettings && !showUsage && !openProjectId && !searchOpen && (
            <ModelPicker />
          )}
          {openProjectId && !showSettings && !showUsage && (
            <Button variant="ghost" onClick={() => closeProject()}>
              ← Back to chat
            </Button>
          )}
          <div className="flex-1" />
          <ThemeToggle />
          <Button
            variant={showUsage ? "default" : "outline"}
            onClick={() => {
              setShowUsage((s) => !s);
              setShowSettings(false);
            }}
          >
            Usage
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowSettings((s) => !s);
              setShowUsage(false);
            }}
          >
            {showSettings ? "Close" : "Settings"}
          </Button>
        </header>

        {showSettings ? (
          <SettingsView />
        ) : showUsage ? (
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
  );
}

export default App;
