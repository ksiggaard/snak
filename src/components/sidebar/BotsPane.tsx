import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useThreads } from "@/store/threads";
import { useBots } from "@/store/bots";
import { useWorkspaces } from "@/store/workspaces";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useAppearance } from "@/store/appearance";
import { confirmDialog } from "@/store/confirm";
import { t as tNow, useT } from "@/store/i18n";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { ThreadRow } from "./ThreadRow";
import { useThreadSnippets } from "./useThreadSnippets";
import { listStyleShowsSnippet } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import type { Bot } from "@/types/db";

/** Bots mode (T38): the bot list; opening one shows its editor view in the
 *  main pane and reveals its threads here. Mirrors WorkspacesPane. */
export function BotsPane() {
  const t = useT();
  const threads = useThreads((s) => s.threads);
  const currentId = useThreads((s) => s.currentThreadId);
  const runningStreams = useThreads((s) => s.runningStreams);
  const unreadThreads = useThreads((s) => s.unreadThreads);
  const selectThread = useThreads((s) => s.selectThread);
  const startNewChatWithBot = useThreads((s) => s.startNewChatWithBot);

  const bots = useBots((s) => s.bots);
  const openBotId = useBots((s) => s.openBotId);
  const openBot = useBots((s) => s.open);
  const closeBot = useBots((s) => s.close);
  const removeBot = useBots((s) => s.remove);
  const closeWorkspace = useWorkspaces((s) => s.close);

  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);
  const listStyle = useAppearance((s) => s.chatListStyle);
  // One query covering every bot's threads, only for snippet styles (T35).
  const snippets = useThreadSnippets(threads, listStyleShowsSnippet(listStyle));

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Opening a bot shows its editor pane (leave settings/usage); closing any
  // open workspace keeps the bot/workspace views mutually exclusive.
  const goBot = (id: string) => {
    showChat();
    clearSearch();
    closeWorkspace();
    openBot(id);
  };
  const selectChat = (id: string) => {
    showChat();
    clearSearch();
    closeWorkspace();
    closeBot();
    void selectThread(id);
  };
  const newChat = (bot: Bot) => {
    showChat();
    clearSearch();
    closeWorkspace();
    closeBot();
    startNewChatWithBot(bot);
  };

  if (bots.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-4 text-xs">
        {t("sidebar.noBots")}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {bots.map((bot) => {
        const isCollapsed = collapsed[bot.id];
        const botThreads = threads.filter((t) => t.bot_id === bot.id);
        const isOpen = openBotId === bot.id;
        return (
          <div key={bot.id} className="mb-1">
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
                    ? t("sidebar.expandBot")
                    : t("sidebar.collapseBot")
                }
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [bot.id]: !c[bot.id] }))
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
                onClick={() => goBot(bot.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium"
                title={t("sidebar.editBot")}
              >
                <BotAvatar bot={bot} className="size-5 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{bot.name}</span>
                  {bot.tagline && (
                    <span className="text-muted-foreground truncate text-xs font-normal">
                      {bot.tagline}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("sidebar.newChatWithBot", { name: bot.name })}
                onClick={() => newChat(bot)}
                className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100"
                title={t("sidebar.newChatWithBot", { name: bot.name })}
              >
                <Plus className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t("sidebar.deleteBot")}
                onClick={() => {
                  void confirmDialog({
                    title: tNow("sidebar.deleteBotTitle", { name: bot.name }),
                    description: tNow("sidebar.deleteBotDescription"),
                    confirmText: tNow("common.delete"),
                    destructive: true,
                  }).then((ok) => {
                    if (ok) void removeBot(bot.id);
                  });
                }}
                className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            {!isCollapsed && (
              <div className="border-sidebar-border ml-3 border-l pl-1">
                {botThreads.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-1 text-xs">
                    {t("sidebar.noChatsWithBot")}
                  </p>
                ) : (
                  botThreads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      active={t.id === currentId}
                      onSelect={() => selectChat(t.id)}
                      snippet={snippets.get(t.id)}
                      isRunning={runningStreams.has(t.id)}
                      isUnread={unreadThreads.has(t.id)}
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
