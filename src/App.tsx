import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DEFAULT_SHORTCUT,
  SHORTCUT_KEY,
  CLOSE_TO_TRAY_KEY,
} from "@/components/settings/Behavior";
import { SettingsView } from "@/components/settings/SettingsView";
import { ChatView } from "@/components/chat/ChatView";
import { WorkspacePage } from "@/components/workspaces/WorkspacePage";
import { BotView } from "@/components/bots/BotView";
import { LibraryArtifactView } from "@/components/chat/LibraryArtifactView";
import { UsageView } from "@/components/usage/UsageView";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SidebarRail } from "@/components/sidebar/SidebarRail";
import { SidebarPane } from "@/components/sidebar/SidebarPane";
import { TitleBar } from "@/components/TitleBar";
import { WindowResizeHandles } from "@/components/WindowResizeHandles";
import { MenuBar } from "@/components/MenuBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSetting, purgeEphemeralThreads } from "@/lib/db";
import { tierForWidth, RAIL_BREAKPOINT, PHONE_BREAKPOINT } from "@/lib/layout";
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
import { useWorkspaces } from "@/store/workspaces";
import { useBots } from "@/store/bots";
import { useLibrary } from "@/store/library";
import { usePlugins } from "@/store/plugins";
import { useSkills } from "@/store/skills";
import { useI18n, useT } from "@/store/i18n";
import { useModels } from "@/store/models";
import { useContextWindows } from "@/store/contextWindows";
import { useKeys } from "@/store/keys";
import { useCustomProviders } from "@/store/customProviders";
import { useOllama } from "@/store/ollama";
import { useConnectivity } from "@/store/connectivity";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";
import { useTitleBar } from "@/store/titlebar";
import { useZoom } from "@/store/zoom";
import { useAudio } from "@/store/audio";
// Side-effect import: applies the stored custom color/typography overrides at
// module load, before first paint (T30/T33) — mirrors store/theme's bootstrap.
import "@/store/appearance";

function App() {
  const t = useT();
  const init = useThreads((s) => s.init);
  const initWorkspaces = useWorkspaces((s) => s.init);
  const initBots = useBots((s) => s.init);
  const loadPlugins = usePlugins((s) => s.load);
  const loadModels = useModels((s) => s.load);
  const loadContextWindows = useContextWindows((s) => s.load);
  const loadKeys = useKeys((s) => s.load);
  const refreshOllama = useOllama((s) => s.refresh);
  const initConnectivity = useConnectivity((s) => s.init);
  const loadUserLanguagePacks = useI18n((s) => s.loadUserPacks);
  const openWorkspaceId = useWorkspaces((s) => s.openWorkspaceId);
  const openBotId = useBots((s) => s.openBotId);
  const openLibraryId = useLibrary((s) => s.openId);
  const view = useView((s) => s.view);
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const sidebarWidth = useLayout((s) => s.sidebarWidth);
  const tier = useLayout((s) => s.tier);
  const setTier = useLayout((s) => s.setTier);
  const compactNav = useLayout((s) => s.compactNav);
  const setCompactNav = useLayout((s) => s.setCompactNav);
  const peeking = useLayout((s) => s.peeking);
  const setPeeking = useLayout((s) => s.setPeeking);
  const titleBarMode = useTitleBar((s) => s.mode);
  const menuBarMode = useTitleBar((s) => s.menuBar);
  const runningStreams = useThreads((s) => s.runningStreams);
  const unreadThreads = useThreads((s) => s.unreadThreads);

  // Collapse the floating rail-peek once a thread is opened (the user picked a
  // chat). Mouse-out is handled by the peek wrapper's onMouseLeave.
  useEffect(
    () =>
      useThreads.subscribe((s, prev) => {
        if (s.currentThreadId !== prev.currentThreadId) {
          useLayout.getState().setPeeking(false);
        }
      }),
    [],
  );

  // Dynamic window title: show a busy marker when any thread is streaming and
  // an unread count when background threads have completed responses.
  useEffect(() => {
    let prefix = "";
    let suffix = "";
    if (runningStreams.size > 0) prefix = "\u25CF ";
    if (unreadThreads.size > 0) suffix = ` (${unreadThreads.size})`;
    void getCurrentWindow().setTitle(prefix + "snak" + suffix);
  }, [runningStreams, unreadThreads]);

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
    void initWorkspaces();
    void initBots();
    void loadKeys();
    void loadPlugins();
    void loadModels();
    // User-added OpenAI-compatible providers (endpoint + optional key) — they
    // appear in the model picker / API-keys card once loaded.
    void useCustomProviders.getState().load();
    // Per-model max context windows (T53) — used by the composer's context
    // readout; empty by default so it just shows an estimate until configured.
    void loadContextWindows();
    // Probe the local Ollama daemon once at startup (T37) — fire-and-forget;
    // the composer/settings react to the store as the answer lands.
    void refreshOllama();
    // Detect internet reachability + wire online/offline listeners (offline
    // mode) — fire-and-forget; the UI gates off the store as the answer lands.
    void initConnectivity();
    // Bundled language packs apply synchronously at module load (no flash);
    // this folds in user packs from the app-data languages folder (T32).
    void loadUserLanguagePacks();
    // Re-apply the persisted webview zoom (browser-style Ctrl/Cmd +/-/0).
    useZoom.getState().setZoom(useZoom.getState().zoom);
    // Audio plugin: load persisted TTS/STT selections + probe tool availability
    // (fire-and-forget) so the chat mic/speak buttons honor saved choices.
    void useAudio.getState().load();
    // Skills (Agent Skills): load the discovered SKILL.md index so the system
    // prompt and the `skill__*` tool gate are current from first send.
    void useSkills.getState().list();
  }, [
    init,
    initWorkspaces,
    initBots,
    loadKeys,
    loadPlugins,
    loadModels,
    loadContextWindows,
    refreshOllama,
    initConnectivity,
    loadUserLanguagePacks,
  ]);

  // Track the responsive tier (wide ≥600 / tablet / phone) for the rail + the
  // 3-step compact toggle. matchMedia keeps it in sync without a resize storm.
  useEffect(() => {
    const apply = () => setTier(tierForWidth(window.innerWidth));
    apply();
    const mq = window.matchMedia(`(min-width: ${RAIL_BREAKPOINT}px)`);
    const mqPhone = window.matchMedia(`(min-width: ${PHONE_BREAKPOINT}px)`);
    mq.addEventListener("change", apply);
    mqPhone.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      mqPhone.removeEventListener("change", apply);
    };
  }, [setTier]);

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
      useWorkspaces.getState().close();
      useBots.getState().close();
      useView.getState().showChat();
      useLayout.getState().setCompactNav(0);
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

  // Click on a "reply done" OS notification (emitted by the Rust notify command
  // after it raises the window): switch to chat and open the thread that finished.
  useEffect(() => {
    const unlisten = listen<string>("notify-activate", (e) => {
      useView.getState().showChat();
      const { threads, selectThread } = useThreads.getState();
      if (threads.some((t) => t.id === e.payload)) void selectThread(e.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
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

  // Hover-intent for the collapsed-rail peek: a short close delay lets the
  // pointer cross the gap from the rail into the floating pane (which is out of
  // the wrapper's flow) without the peek flickering shut.
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPeekClose = () => {
    if (peekTimer.current !== null) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
  };
  const openPeek = () => {
    cancelPeekClose();
    if (tier === "wide" && !sidebarOpen) setPeeking(true);
  };
  const schedulePeekClose = () => {
    cancelPeekClose();
    peekTimer.current = setTimeout(() => setPeeking(false), 140);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-background text-foreground flex h-screen flex-col">
        {/* Custom resize handles — only needed when we draw our own (decoration-
            less) title bar; native mode lets the OS own window resize. */}
        {titleBarMode === "custom" && <WindowResizeHandles />}
        <TitleBar />
        {menuBarMode === "inline" && <MenuBar />}
        <ConfirmDialog />
        <ImageLightbox />
        <SearchOverlay />

        <div className="canvas-bg flex min-h-0 flex-1 gap-3 p-3">
          {/* Icon rail (wide tier): always visible, independent of the pane.
              When the pane is collapsed the rail becomes a hover trigger that
              floats the list over the chat (no layout shift). */}
          {tier === "wide" && (
            <div
              className="relative flex"
              onMouseEnter={openPeek}
              onMouseLeave={schedulePeekClose}
            >
              <SidebarRail />
              {!sidebarOpen && (
                <AnimatePresence>
                  {peeking && (
                    <motion.aside
                      initial={{ x: -16, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: -12, opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      style={{ width: sidebarWidth }}
                      onMouseEnter={cancelPeekClose}
                      onMouseLeave={schedulePeekClose}
                      className="bg-sidebar text-sidebar-foreground ring-foreground/10 absolute top-0 left-full z-30 ml-2 flex h-full flex-col overflow-hidden rounded-2xl shadow-2xl ring-1"
                    >
                      <SidebarPane />
                    </motion.aside>
                  )}
                </AnimatePresence>
              )}
            </div>
          )}

          {/* Inline list pane (wide tier): shown unless collapsed. */}
          {tier === "wide" && sidebarOpen && <Sidebar />}

          {/* Compact tiers (<600px): rail + pane as a left overlay. compactNav
              0 = chat only, 1 = pane, 2 = pane + rail (rail to the left). */}
          <Sheet
            open={compactNav >= 1}
            onOpenChange={(o) => setCompactNav(o ? 1 : 0)}
          >
            <SheetContent
              side="left"
              showCloseButton={false}
              className="bg-sidebar text-sidebar-foreground flex flex-row gap-0 p-0"
              style={{
                top: menuBarMode === "inline" ? 68 : 40,
                height: `calc(100% - ${menuBarMode === "inline" ? 68 : 40}px)`,
                width: compactNav >= 2 ? 320 : 272,
              }}
            >
              <SheetTitle className="sr-only">
                {t("sidebar.navigation")}
              </SheetTitle>
              {compactNav >= 2 && <SidebarRail variant="overlay" />}
              <div className="flex min-w-0 flex-1 flex-col">
                <SidebarPane />
              </div>
            </SheetContent>
          </Sheet>

          <main className="bg-background shadow-sm flex min-w-0 flex-1 flex-col rounded-2xl p-[calc(1.25rem*var(--density-scale,1))] md:p-[calc(1.5rem*var(--density-scale,1))]">
            <AnimatePresence mode="wait">
              <motion.div
                key={
                  view === "settings" || view === "usage"
                    ? view
                    : openBotId
                      ? `bot:${openBotId}`
                      : openLibraryId
                        ? `library:${openLibraryId}`
                        : openWorkspaceId
                          ? `workspace:${openWorkspaceId}`
                          : "chat"
                }
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {view === "settings" ? (
                  <SettingsView />
                ) : view === "usage" ? (
                  <UsageView />
                ) : openBotId ? (
                  <BotView />
                ) : openLibraryId ? (
                  <LibraryArtifactView />
                ) : openWorkspaceId ? (
                  <WorkspacePage />
                ) : (
                  <ChatView />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
