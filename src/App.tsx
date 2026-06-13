import { useEffect } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DEFAULT_SHORTCUT, SHORTCUT_KEY } from "@/components/settings/Shortcut";
import { CLOSE_TO_TRAY_KEY } from "@/components/settings/CloseToTray";
import { SettingsView } from "@/components/settings/SettingsView";
import { ChatView } from "@/components/chat/ChatView";
import { ProjectView } from "@/components/projects/ProjectView";
import { BotView } from "@/components/bots/BotView";
import { UsageView } from "@/components/usage/UsageView";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { Sidebar, SidebarContent } from "@/components/sidebar/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { MenuBar } from "@/components/MenuBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSetting, purgeEphemeralThreads } from "@/lib/db";
import {
  menuActionForKey,
  runMenuAction,
  type MenuAction,
} from "@/lib/menuActions";
import { setGlobalShortcut, type QuickPayload } from "@/lib/quick";
import {
  QUICK_RECENTS_EVENT,
  QUICK_RECENTS_REQUEST_EVENT,
  recentDestinations,
} from "@/lib/quickDestinations";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { useBots } from "@/store/bots";
import { usePlugins } from "@/store/plugins";
import { useI18n, useT } from "@/store/i18n";
import { useModels } from "@/store/models";
import { useKeys } from "@/store/keys";
import { useOllama } from "@/store/ollama";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";
import { useTitleBar } from "@/store/titlebar";
// Side-effect import: applies the stored custom color/typography overrides at
// module load, before first paint (T30/T33) — mirrors store/theme's bootstrap.
import "@/store/appearance";

function App() {
  const t = useT();
  const init = useThreads((s) => s.init);
  const initProjects = useProjects((s) => s.init);
  const initBots = useBots((s) => s.init);
  const loadPlugins = usePlugins((s) => s.load);
  const loadModels = useModels((s) => s.load);
  const loadKeys = useKeys((s) => s.load);
  const refreshOllama = useOllama((s) => s.refresh);
  const loadUserLanguagePacks = useI18n((s) => s.loadUserPacks);
  const openProjectId = useProjects((s) => s.openProjectId);
  const openBotId = useBots((s) => s.openBotId);
  const view = useView((s) => s.view);
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const mobileOpen = useLayout((s) => s.mobileOpen);
  const setMobileOpen = useLayout((s) => s.setMobileOpen);
  const titleBarMode = useTitleBar((s) => s.mode);
  const menuBarMode = useTitleBar((s) => s.menuBar);

  // Sync the OS window decorations with the title-bar preference. Rust strips
  // decorations at startup (the default is the custom bar); this restores them
  // when "native" is saved, and toggles live when the setting changes. Done
  // here (not in the store) so it only ever targets the main window.
  useEffect(() => {
    void getCurrentWindow().setDecorations(titleBarMode === "native");
  }, [titleBarMode]);

  // Sync the native in-window menubar's visibility (Linux/Windows; no-op on
  // macOS). "inline"/"hidden" hide the widget — the menu stays installed so a
  // global-menu panel can still export it.
  useEffect(() => {
    void invoke("set_menu_visible", { visible: menuBarMode === "native" });
  }, [menuBarMode]);

  useEffect(() => {
    void init();
    void initProjects();
    void initBots();
    void loadKeys();
    void loadPlugins();
    void loadModels();
    // Probe the local Ollama daemon once at startup (T37) — fire-and-forget;
    // the composer/settings react to the store as the answer lands.
    void refreshOllama();
    // Bundled language packs apply synchronously at module load (no flash);
    // this folds in user packs from the app-data languages folder (T32).
    void loadUserLanguagePacks();
  }, [
    init,
    initProjects,
    initBots,
    loadKeys,
    loadPlugins,
    loadModels,
    refreshOllama,
    loadUserLanguagePacks,
  ]);

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

  // T29: best-effort incognito purge on quit. Registering a JS close-requested
  // listener makes Tauri defer the close until the handler resolves, so:
  //  * close-to-tray ON  → the Rust handler has already hidden the window; we
  //    preventDefault so the JS wrapper doesn't destroy it (hide-to-tray keeps
  //    the session — and its incognito threads — alive).
  //  * close-to-tray OFF → a real exit: purge ephemeral threads, then let the
  //    window be destroyed.
  // Tray Quit / File→Quit call `app.exit` in Rust and never reach this handler
  // — for those (and crashes/kills) the startup purge in `init()` is the
  // authoritative, crash-safe guarantee.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      const v = await getSetting(CLOSE_TO_TRAY_KEY);
      const closeToTray = v === null ? true : v === "1";
      if (closeToTray) {
        event.preventDefault();
        return;
      }
      try {
        await purgeEphemeralThreads();
      } catch {
        // Best-effort only — the startup purge covers any failure here.
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<QuickPayload>("quick-submit", (e) => {
      useProjects.getState().close();
      useBots.getState().close();
      useView.getState().showChat();
      useLayout.getState().setMobileOpen(false);
      // Read the store at event time so the threads list is fresh (T31: the
      // payload may target an existing thread that was deleted meanwhile).
      const { threads, selectThread, startNewChat, send, setProviderModel } =
        useThreads.getState();
      const targetId = e.payload.thread_id;
      if (targetId && threads.some((t) => t.id === targetId)) {
        // Existing destination thread: send into it with its saved
        // provider/model (the overlay's chooser only applies to new chats).
        void selectThread(targetId).then(() =>
          send(e.payload.text, e.payload.images),
        );
        return;
      }
      // New chat (default), or the chosen recent no longer exists.
      startNewChat();
      if (e.payload.provider && e.payload.model) {
        void setProviderModel(e.payload.provider, e.payload.model);
      }
      void send(e.payload.text, e.payload.images);
    });
    // T31: Rust `show_quick` asks for recents each time the overlay is shown;
    // answer with the most recently updated threads from the in-memory store
    // (no DB query — the store list is already ordered by updated_at).
    const unlistenRecents = listen(QUICK_RECENTS_REQUEST_EVENT, () => {
      void emitTo(
        "quick",
        QUICK_RECENTS_EVENT,
        recentDestinations(useThreads.getState().threads),
      );
    });
    return () => {
      void unlisten.then((fn) => fn());
      void unlistenRecents.then((fn) => fn());
    };
  }, []);

  // Native application menu (macOS menu bar / Linux global menu): the Rust
  // side emits an action string per selection; `runMenuAction` maps it onto
  // the stores (shared with the in-app MenuBar).
  useEffect(() => {
    const unlisten = listen<MenuAction>("app-menu", (e) =>
      runMenuAction(e.payload),
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // In-app keyboard shortcuts for the same actions (Ctrl/Cmd+N, K, B, comma,
  // Q) — see `menuActionForKey` for why these don't clash with the native
  // menu's accelerators.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = menuActionForKey(e);
      if (!action) return;
      e.preventDefault();
      runMenuAction(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-background text-foreground flex h-screen flex-col">
        <TitleBar />
        {menuBarMode === "inline" && <MenuBar />}
        <ConfirmDialog />
        <ImageLightbox />
        <SearchOverlay />

        <div className="flex min-h-0 flex-1">
          {/* Inline sidebar (>= md), shown unless collapsed. */}
          {sidebarOpen && <Sidebar />}

          {/* Overlay sidebar for narrow widths. Offset below the chrome
              (TitleBar 32px + inline MenuBar 28px) so the Sheet doesn't cover
              the topbar / the hamburger that opens it. Inline style overrides
              the shadcn `top-0`/`h-full` classes. */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="bg-sidebar text-sidebar-foreground gap-0 p-0"
              style={{
                top: menuBarMode === "inline" ? 60 : 32,
                height: `calc(100% - ${menuBarMode === "inline" ? 60 : 32}px)`,
              }}
            >
              <SheetTitle className="sr-only">
                {t("sidebar.navigation")}
              </SheetTitle>
              <SidebarContent />
            </SheetContent>
          </Sheet>

          <main className="flex min-w-0 flex-1 flex-col p-3 md:p-4">
            {/* Keyed so switching views replays the fade-in (T46). The
                `.no-animations` kill-switch makes this instant when disabled. */}
            <div
              key={
                view === "settings" || view === "usage"
                  ? view
                  : openBotId
                    ? `bot:${openBotId}`
                    : openProjectId
                      ? `project:${openProjectId}`
                      : "chat"
              }
              className="animate-in fade-in-0 flex min-h-0 flex-1 flex-col duration-200"
            >
              {view === "settings" ? (
                <SettingsView />
              ) : view === "usage" ? (
                <UsageView />
              ) : openBotId ? (
                <BotView />
              ) : openProjectId ? (
                <ProjectView />
              ) : (
                <ChatView />
              )}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
