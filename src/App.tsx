import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { ApiKeys } from "@/components/settings/ApiKeys";
import {
  DEFAULT_SHORTCUT,
  SHORTCUT_KEY,
  ShortcutSetting,
} from "@/components/settings/Shortcut";
import {
  CLOSE_TO_TRAY_KEY,
  CloseToTraySetting,
} from "@/components/settings/CloseToTray";
import { ChatView } from "@/components/chat/ChatView";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { ProjectView } from "@/components/projects/ProjectView";
import { ThreadList } from "@/components/sidebar/ThreadList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getSetting } from "@/lib/db";
import { setGlobalShortcut, type QuickPayload } from "@/lib/quick";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";

function App() {
  const init = useThreads((s) => s.init);
  const initProjects = useProjects((s) => s.init);
  const openProjectId = useProjects((s) => s.openProjectId);
  const closeProject = useProjects((s) => s.close);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void init();
    void initProjects();
  }, [init, initProjects]);

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
      <ThreadList />

      <main className="flex flex-1 flex-col gap-3 p-4">
        <header className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">KDE LLM</h1>
          {!showSettings && !openProjectId && <ModelPicker />}
          {openProjectId && !showSettings && (
            <Button variant="ghost" onClick={() => closeProject()}>
              ← Back to chat
            </Button>
          )}
          <div className="flex-1" />
          <ThemeToggle />
          <Button variant="outline" onClick={() => setShowSettings((s) => !s)}>
            {showSettings ? "Close" : "Settings"}
          </Button>
        </header>

        {showSettings ? (
          <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto">
            <ApiKeys />
            <ShortcutSetting />
            <CloseToTraySetting />
          </div>
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
