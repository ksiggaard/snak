import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { useThreads } from "@/store/threads";
import { useWorkspaces } from "@/store/workspaces";
import { useBots } from "@/store/bots";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useAppearance } from "@/store/appearance";
import { confirmDialog } from "@/store/confirm";
import { t as tNow, useT } from "@/store/i18n";
import { ThreadRow } from "./ThreadRow";
import { useThreadSnippets } from "./useThreadSnippets";
import { listStyleShowsSnippet } from "@/lib/appearance";
import { cn } from "@/lib/utils";

/** Workspaces mode (T24/T58): the workspace list; opening one shows its detail
 *  view in the main pane and reveals its threads here. */
export function WorkspacesPane() {
  const t = useT();
  const threads = useThreads((s) => s.threads);
  const currentId = useThreads((s) => s.currentThreadId);
  const selectThread = useThreads((s) => s.selectThread);
  const startNewChatInWorkspace = useThreads((s) => s.startNewChatInWorkspace);

  const workspaces = useWorkspaces((s) => s.workspaces);
  const openWorkspaceId = useWorkspaces((s) => s.openWorkspaceId);
  const openWorkspace = useWorkspaces((s) => s.open);
  const closeWorkspace = useWorkspaces((s) => s.close);
  const removeWorkspace = useWorkspaces((s) => s.remove);
  const closeBot = useBots((s) => s.close);

  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);
  const listStyle = useAppearance((s) => s.chatListStyle);
  // One query covering every workspace's threads, only for snippet styles (T35).
  const snippets = useThreadSnippets(threads, listStyleShowsSnippet(listStyle));

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Opening a workspace shows its detail pane (leave settings/usage); closing
  // any open bot editor keeps the bot/workspace views mutually exclusive.
  const goWorkspace = (id: string) => {
    showChat();
    clearSearch();
    closeBot();
    void openWorkspace(id);
  };
  const selectChat = (id: string) => {
    showChat();
    clearSearch();
    closeWorkspace();
    closeBot();
    void selectThread(id);
  };
  const newChat = (workspaceId: string) => {
    showChat();
    clearSearch();
    closeWorkspace();
    closeBot();
    startNewChatInWorkspace(workspaceId);
  };

  if (workspaces.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-4 text-xs">
        {t("sidebar.noWorkspaces")}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {workspaces.map((workspace) => {
        const isCollapsed = collapsed[workspace.id];
        const workspaceThreads = threads.filter(
          (t) => t.workspace_id === workspace.id,
        );
        const isOpen = openWorkspaceId === workspace.id;
        return (
          <div key={workspace.id} className="mb-1">
            <div
              className={cn(
                "group flex items-center gap-1 rounded-md px-1.5 py-1.5",
                isOpen ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
              )}
            >
              <button
                type="button"
                aria-label={
                  isCollapsed
                    ? t("sidebar.expandWorkspace")
                    : t("sidebar.collapseWorkspace")
                }
                onClick={() =>
                  setCollapsed((c) => ({
                    ...c,
                    [workspace.id]: !c[workspace.id],
                  }))
                }
                className="text-muted-foreground shrink-0"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => goWorkspace(workspace.id)}
                className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                title={t("sidebar.openWorkspace")}
              >
                {workspace.name}
              </button>
              <button
                type="button"
                aria-label={t("sidebar.newChatInWorkspace")}
                onClick={() => newChat(workspace.id)}
                className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100"
                title={t("sidebar.newChatInWorkspace")}
              >
                <Plus className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t("sidebar.editWorkspace")}
                onClick={() => goWorkspace(workspace.id)}
                className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100"
                title={t("sidebar.editWorkspace")}
              >
                <Settings2 className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t("sidebar.deleteWorkspace")}
                onClick={() => {
                  void confirmDialog({
                    title: tNow("sidebar.deleteWorkspaceTitle", {
                      name: workspace.name,
                    }),
                    description: tNow("sidebar.deleteWorkspaceDescription"),
                    confirmText: tNow("common.delete"),
                    destructive: true,
                  }).then((ok) => {
                    if (ok) void removeWorkspace(workspace.id);
                  });
                }}
                className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            {!isCollapsed && (
              <div className="border-sidebar-border ml-3 border-l pl-1">
                {workspaceThreads.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-1 text-xs">
                    {t("sidebar.noChatsInWorkspace")}
                  </p>
                ) : (
                  workspaceThreads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      active={t.id === currentId}
                      onSelect={() => selectChat(t.id)}
                      snippet={snippets.get(t.id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
