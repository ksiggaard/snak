import type { ReactNode } from "react";
import { Bot, FolderPlus, Ghost, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatsPane } from "./ChatsPane";
import { WorkspacesPane } from "./WorkspacesPane";
import { BotsPane } from "./BotsPane";
import { ArtifactsPane } from "./ArtifactsPane";
import { SettingsPane } from "./SettingsPane";
import { useThreads } from "@/store/threads";
import { useWorkspaces } from "@/store/workspaces";
import { useBots } from "@/store/bots";
import { useLibrary } from "@/store/library";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";
import { useT } from "@/store/i18n";

/** The list pane: a contextual header (section title + New action) over the
 *  active Chats / Workspaces / Personas list. Rendered inside the inline aside
 *  (wide) and inside the compact overlay Sheet. */
export function SidebarPane() {
  const t = useT();
  const mode = useLayout((s) => s.sidebarMode);
  const startNewChat = useThreads((s) => s.startNewChat);
  const createWorkspace = useWorkspaces((s) => s.create);
  const openWorkspace = useWorkspaces((s) => s.open);
  const closeWorkspace = useWorkspaces((s) => s.close);
  const createBot = useBots((s) => s.create);
  const openBot = useBots((s) => s.open);
  const closeBot = useBots((s) => s.close);
  const saveLibrary = useLibrary((s) => s.save);
  const setLibraryOpenId = useLibrary((s) => s.setOpenId);
  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);

  const onNewChat = (opts?: { incognito?: boolean }) => {
    showChat();
    clearSearch();
    closeWorkspace();
    closeBot();
    startNewChat(opts);
  };

  const onNewWorkspace = async () => {
    showChat();
    clearSearch();
    closeBot();
    const w = await createWorkspace();
    await openWorkspace(w.id);
  };

  const onNewBot = async () => {
    showChat();
    clearSearch();
    closeWorkspace();
    const b = await createBot();
    openBot(b.id);
  };

  const SCAFFOLD_HTML = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>Untitled Artifact</title>",
    '  <link rel="stylesheet" href="style.css">',
    "</head>",
    "<body>",
    "  <h1>Hello</h1>",
    '  <script type="module" src="script.js"></script>',
    "</body>",
    "</html>",
  ].join("\n");

  const onNewArtifact = async () => {
    showChat();
    clearSearch();
    closeWorkspace();
    closeBot();
    const item = await saveLibrary("Untitled Artifact", [
      { path: "index.html", content: SCAFFOLD_HTML },
      {
        path: "style.css",
        content: [
          "body {",
          "  font-family: system-ui, sans-serif;",
          "  max-width: 800px;",
          "  margin: 2rem auto;",
          "  padding: 0 1rem;",
          "}",
        ].join("\n"),
      },
      {
        path: "script.js",
        content: "console.log('Hello from script.js');\n",
      },
    ]);
    setLibraryOpenId(item.id);
  };

  const title =
    mode === "chats"
      ? t("sidebar.chats")
      : mode === "projects"
        ? t("sidebar.workspaces")
        : mode === "bots"
          ? t("sidebar.bots")
          : mode === "artifacts"
            ? t("sidebar.artifacts")
            : t("titleBar.settings");

  return (
    <>
      <div className="flex items-center justify-between gap-1 px-4 pt-4 pb-1">
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
              label={t("sidebar.newWorkspace")}
              onClick={() => void onNewWorkspace()}
            >
              <FolderPlus className="size-4" />
            </PaneAction>
          ) : mode === "bots" ? (
            <PaneAction
              label={t("sidebar.newBot")}
              onClick={() => void onNewBot()}
            >
              <Bot className="size-4" />
            </PaneAction>
          ) : mode === "artifacts" ? (
            <PaneAction
              label={t("library.new")}
              onClick={() => void onNewArtifact()}
            >
              <Plus className="size-4" />
            </PaneAction>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {mode === "chats" ? (
          <ChatsPane />
        ) : mode === "projects" ? (
          <WorkspacesPane />
        ) : mode === "bots" ? (
          <BotsPane />
        ) : mode === "artifacts" ? (
          <ArtifactsPane />
        ) : (
          <SettingsPane />
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
