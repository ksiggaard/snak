import type { ReactNode } from "react";
import { Bot, FolderPlus, Ghost, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

/** The list pane: a contextual header (section title + New action) over the
 *  active Chats / Projects / Personas list. Rendered inside the inline aside
 *  (wide) and inside the compact overlay Sheet. */
export function SidebarPane() {
  const t = useT();
  const mode = useLayout((s) => s.sidebarMode);
  const startNewChat = useThreads((s) => s.startNewChat);
  const createProject = useProjects((s) => s.create);
  const openProject = useProjects((s) => s.open);
  const closeProject = useProjects((s) => s.close);
  const createBot = useBots((s) => s.create);
  const openBot = useBots((s) => s.open);
  const closeBot = useBots((s) => s.close);
  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);

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

  const title =
    mode === "chats"
      ? t("sidebar.chats")
      : mode === "projects"
        ? t("sidebar.projects")
        : t("sidebar.bots");

  return (
    <>
      <div className="flex items-center justify-between gap-1 px-3 pt-3 pb-1">
        <span className="text-sidebar-foreground/60 text-xs font-semibold tracking-wide uppercase">
          {title}
        </span>
        <div className="flex items-center gap-0.5">
          {mode === "chats" ? (
            <>
              <PaneAction
                label={t("sidebar.newChat")}
                onClick={() => onNewChat()}
              >
                <Plus className="size-4" />
              </PaneAction>
              <PaneAction
                label={t("sidebar.newIncognitoChat")}
                onClick={() => onNewChat({ incognito: true })}
              >
                <Ghost className="size-4" />
              </PaneAction>
            </>
          ) : mode === "projects" ? (
            <PaneAction
              label={t("sidebar.newProject")}
              onClick={() => void onNewProject()}
            >
              <FolderPlus className="size-4" />
            </PaneAction>
          ) : (
            <PaneAction
              label={t("sidebar.newBot")}
              onClick={() => void onNewBot()}
            >
              <Bot className="size-4" />
            </PaneAction>
          )}
        </div>
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

function PaneAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-7 items-center justify-center rounded-md transition-colors"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
