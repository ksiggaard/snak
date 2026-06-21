import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useThreads } from "@/store/threads";
import { confirmDialog } from "@/store/confirm";
import { useWorkspaces } from "@/store/workspaces";
import { useBots } from "@/store/bots";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useAppearance } from "@/store/appearance";
import { t as tNow, useT } from "@/store/i18n";
import { ThreadRow } from "./ThreadRow";
import { useThreadSnippets } from "./useThreadSnippets";
import { listStyleShowsSnippet } from "@/lib/appearance";

/** Chats mode (T24): a flat list of all threads — workspace-less and
 *  in-workspace alike — with a Favorites group (T23) pinned on top. */
export function ChatsPane() {
  const t = useT();
  const threads = useThreads((s) => s.threads);
  const currentId = useThreads((s) => s.currentThreadId);
  const runningStreams = useThreads((s) => s.runningStreams);
  const unreadThreads = useThreads((s) => s.unreadThreads);
  const selectThread = useThreads((s) => s.selectThread);
  const clearArchive = useThreads((s) => s.clearArchive);
  const closeWorkspace = useWorkspaces((s) => s.close);
  const closeBot = useBots((s) => s.close);
  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);
  const listStyle = useAppearance((s) => s.chatListStyle);
  // One query for the whole visible list, only for snippet row styles (T35).
  const snippets = useThreadSnippets(threads, listStyleShowsSnippet(listStyle));
  // Archive group disclosure — collapsed by default, per-session only.
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Selecting a chat returns the main pane to the chat view (clear search,
  // close any open workspace/bot editor, leave settings/usage).
  const select = useCallback(
    (id: string) => {
      clearSearch();
      closeWorkspace();
      closeBot();
      showChat();
      void selectThread(id);
    },
    [clearSearch, closeWorkspace, closeBot, showChat, selectThread],
  );

  // Stable per-thread callbacks so React.memo on ThreadRow works.
  const [selectCallbacks] = useState(() => new Map<string, () => void>());
  const getSelect = (id: string) => {
    let cb = selectCallbacks.get(id);
    if (!cb) {
      cb = () => select(id);
      selectCallbacks.set(id, cb);
    }
    return cb;
  };

  if (threads.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-4 text-xs">
        {t("sidebar.noConversations")}
      </p>
    );
  }

  // Compute the groups from the live thread list (stale-safe: a thread
  // removed elsewhere simply drops out). Tabs metaphor: archived chats leave
  // the open groups and collect in a collapsible Archive at the bottom;
  // opening one (selectThread) promotes it back to open.
  const open = threads.filter((t) => !t.archived);
  const favorites = open.filter((t) => t.favorite);
  const rest = open.filter((t) => !t.favorite);
  const archived = threads.filter((t) => !!t.archived);

  return (
    <div className="flex flex-col gap-2">
      {favorites.length > 0 && (
        <section className="stagger-container">
          <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
            {t("sidebar.favorites")}
          </p>
          {favorites.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              active={t.id === currentId}
              onSelect={getSelect(t.id)}
              snippet={snippets.get(t.id)}
              isRunning={runningStreams.has(t.id)}
              isUnread={unreadThreads.has(t.id)}
            />
          ))}
        </section>
      )}
      <section className="stagger-container">
        {favorites.length > 0 && rest.length > 0 && (
          <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
            {t("sidebar.allChats")}
          </p>
        )}
        {rest.map((t) => (
          <ThreadRow
            key={t.id}
            thread={t}
            active={t.id === currentId}
              onSelect={getSelect(t.id)}
            snippet={snippets.get(t.id)}
            isRunning={runningStreams.has(t.id)}
            isUnread={unreadThreads.has(t.id)}
          />
        ))}
      </section>
      {archived.length > 0 && (
      <section className="stagger-container">
          <div className="group/archive flex items-center gap-1 px-2 py-1">
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              className="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 text-xs font-medium"
            >
              {archiveOpen ? (
                <ChevronDown className="size-3.5" aria-hidden />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden />
              )}
              {t("sidebar.archive")}
              <span className="text-muted-foreground/70 ml-auto tabular-nums">
                {archived.length}
              </span>
            </button>
            <button
              type="button"
              aria-label={t("sidebar.clearArchive")}
              title={t("sidebar.clearArchive")}
              onClick={() => {
                void confirmDialog({
                  title: tNow("sidebar.clearArchiveTitle", {
                    count: archived.length,
                  }),
                  confirmText: tNow("common.delete"),
                  destructive: true,
                }).then((ok) => {
                  if (ok) void clearArchive();
                });
              }}
              className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover/archive:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {archiveOpen &&
            archived.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                active={t.id === currentId}
                onSelect={getSelect(t.id)}
                snippet={snippets.get(t.id)}
                isRunning={runningStreams.has(t.id)}
                isUnread={unreadThreads.has(t.id)}
              />
            ))}
        </section>
      )}
    </div>
  );
}
