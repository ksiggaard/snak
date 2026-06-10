import { useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useThreads } from "@/store/threads";
import { confirmDialog } from "@/store/confirm";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import type { Provider, Thread } from "@/types/db";

// A thread's provider label for the row subtitle. Uses the static registry
// (all four providers) so the label resolves even for a since-disabled provider.
const providerLabel = (p: Provider) =>
  PROVIDERS.find((x) => x.id === p)?.label ?? p;

interface ThreadRowProps {
  thread: Thread;
  active: boolean;
  /** Navigate to this thread (the parent wires the surrounding view changes). */
  onSelect: () => void;
}

/** One thread entry in the sidebar: select, double-click-to-rename, favorite
 *  star, and delete. Shared by the Chats and Projects panes. */
export function ThreadRow({ thread, active, onSelect }: ThreadRowProps) {
  const rename = useThreads((s) => s.rename);
  const remove = useThreads((s) => s.remove);
  const toggleFavorite = useThreads((s) => s.toggleFavorite);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);

  function beginEdit() {
    setDraft(thread.title);
    setEditing(true);
  }

  async function commitEdit() {
    setEditing(false);
    if (draft.trim() !== thread.title) await rename(thread.id, draft);
  }

  const fav = !!thread.favorite;

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5",
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
      )}
    >
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={beginEdit}
          className="min-w-0 flex-1 text-left"
          title="Double-click to rename"
        >
          <div className="truncate text-sm">{thread.title}</div>
          <div className="text-muted-foreground truncate text-xs">
            {providerLabel(thread.provider)}
          </div>
        </button>
      )}
      <button
        type="button"
        aria-label={fav ? "Unfavorite conversation" : "Favorite conversation"}
        title={fav ? "Unfavorite" : "Favorite"}
        onClick={() => void toggleFavorite(thread.id)}
        className={cn(
          "shrink-0",
          fav
            ? "text-yellow-500"
            : "text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100",
        )}
      >
        <Star className={cn("size-4", fav && "fill-current")} />
      </button>
      <button
        type="button"
        aria-label="Delete conversation"
        onClick={() => {
          void confirmDialog({
            title: `Delete "${thread.title}"?`,
            confirmText: "Delete",
            destructive: true,
          }).then((ok) => {
            if (ok) void remove(thread.id);
          });
        }}
        className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
