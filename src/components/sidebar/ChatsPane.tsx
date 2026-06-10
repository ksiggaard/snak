import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { ThreadRow } from "./ThreadRow";

/** Chats mode (T24): a flat list of all threads — project-less and in-project
 *  alike — with a Favorites group (T23) pinned on top. */
export function ChatsPane() {
  const threads = useThreads((s) => s.threads);
  const currentId = useThreads((s) => s.currentThreadId);
  const selectThread = useThreads((s) => s.selectThread);
  const closeProject = useProjects((s) => s.close);
  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);

  // Selecting a chat returns the main pane to the chat view (clear search,
  // close any open project, leave settings/usage).
  const select = (id: string) => {
    clearSearch();
    closeProject();
    showChat();
    void selectThread(id);
  };

  if (threads.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-4 text-xs">
        No conversations yet.
      </p>
    );
  }

  // Compute the Favorites group from the live thread list (stale-safe: a thread
  // removed elsewhere simply drops out of both groups).
  const favorites = threads.filter((t) => t.favorite);
  const rest = threads.filter((t) => !t.favorite);

  return (
    <div className="flex flex-col gap-2">
      {favorites.length > 0 && (
        <section>
          <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
            Favorites
          </p>
          {favorites.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              active={t.id === currentId}
              onSelect={() => select(t.id)}
            />
          ))}
        </section>
      )}
      <section>
        {favorites.length > 0 && rest.length > 0 && (
          <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
            All chats
          </p>
        )}
        {rest.map((t) => (
          <ThreadRow
            key={t.id}
            thread={t}
            active={t.id === currentId}
            onSelect={() => select(t.id)}
          />
        ))}
      </section>
    </div>
  );
}
