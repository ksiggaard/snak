import { Bot, FolderPlus, Ghost, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarModeSwitch } from "./SidebarModeSwitch";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { ChatsPane } from "./ChatsPane";
import { ProjectsPane } from "./ProjectsPane";
import { BotsPane } from "./BotsPane";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { useBots } from "@/store/bots";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";
import { useT } from "@/store/i18n";

/** The sidebar's inner content: chrome header, Chats/Projects/Bots mode switch
 *  (T24, T38), search + a mode-appropriate "new" action, then the active pane.
 *  Rendered inside the inline `<aside>` (>= md) or a Sheet overlay (< md, T21). */
export function SidebarContent() {
  const t = useT();
  const startNewChat = useThreads((s) => s.startNewChat);
  const createProject = useProjects((s) => s.create);
  const openProject = useProjects((s) => s.open);
  const closeProject = useProjects((s) => s.close);
  const createBot = useBots((s) => s.create);
  const openBot = useBots((s) => s.open);
  const closeBot = useBots((s) => s.close);
  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);
  const mode = useLayout((s) => s.sidebarMode);

  const onNewChat = (opts?: { incognito?: boolean }) => {
    showChat();
    clearSearch();
    closeProject();
    closeBot();
    startNewChat(opts);
  };

  const onNewProject = async () => {
    showChat();
    clearSearch();
    closeBot();
    const p = await createProject();
    await openProject(p.id);
  };

  const onNewBot = async () => {
    showChat();
    clearSearch();
    closeProject();
    const b = await createBot();
    openBot(b.id);
  };

  return (
    <>
      <SidebarHeader />
      <div className="flex flex-col gap-2 px-2 pb-2">
        <SidebarModeSwitch />
        {mode === "chats" ? (
          <div className="flex gap-1">
            <Button
              className="min-w-0 flex-1 justify-start"
              variant="outline"
              onClick={() => onNewChat()}
            >
              <Plus className="size-4" />
              {t("sidebar.newChat")}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("sidebar.newIncognitoChat")}
              title={t("sidebar.newIncognitoChatTitle")}
              onClick={() => onNewChat({ incognito: true })}
            >
              <Ghost className="size-4" />
            </Button>
          </div>
        ) : mode === "projects" ? (
          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={() => void onNewProject()}
          >
            <FolderPlus className="size-4" />
            {t("sidebar.newProject")}
          </Button>
        ) : (
          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={() => void onNewBot()}
          >
            <Bot className="size-4" />
            {t("sidebar.newBot")}
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {mode === "chats" ? (
          <ChatsPane />
        ) : mode === "projects" ? (
          <ProjectsPane />
        ) : (
          <BotsPane />
        )}
      </div>
    </>
  );
}

/** The inline sidebar (>= md): a resizable, persisted-width column (T22). Below
 *  md it's hidden — App renders the same content in an overlay Sheet (T21). */
export function Sidebar() {
  const width = useLayout((s) => s.sidebarWidth);

  return (
    <aside
      // Slides + fades in when shown (T46); instant when animations are off.
      className="bg-sidebar text-sidebar-foreground border-sidebar-border animate-in slide-in-from-left-4 fade-in-0 relative hidden shrink-0 flex-col border-r duration-200 md:flex"
      style={{ width }}
    >
      <SidebarContent />
      <SidebarResizeHandle />
    </aside>
  );
}
