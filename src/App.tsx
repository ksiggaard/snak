import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { ApiKeys } from "@/components/settings/ApiKeys";
import {
  DEFAULT_SHORTCUT,
  SHORTCUT_KEY,
  ShortcutSetting,
} from "@/components/settings/Shortcut";
import { ChatView } from "@/components/chat/ChatView";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { ThreadList } from "@/components/sidebar/ThreadList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getSetting } from "@/lib/db";
import { setGlobalShortcut, type QuickPayload } from "@/lib/quick";
import { useThreads } from "@/store/threads";

function App() {
  const init = useThreads((s) => s.init);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  // Apply the user's saved global shortcut (Rust registers the default already).
  useEffect(() => {
    getSetting(SHORTCUT_KEY).then((v) => {
      if (v && v !== DEFAULT_SHORTCUT) void setGlobalShortcut(v);
    });
  }, []);

  // Quick-input overlay submissions start a new thread in this (main) window.
  useEffect(() => {
    const { startNewChat, send } = useThreads.getState();
    const unlisten = listen<QuickPayload>("quick-submit", (e) => {
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
          <ModelPicker />
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
          </div>
        ) : (
          <ChatView />
        )}
      </main>
    </div>
  );
}

export default App;
