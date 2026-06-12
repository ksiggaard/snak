import { useState } from "react";
import { Ghost, Star, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useAppearance } from "@/store/appearance";
import { confirmDialog } from "@/store/confirm";
import { t as tNow, timeLabels, useIntlLocale, useT } from "@/store/i18n";
import { useProviders } from "@/lib/providers";
import { currentModelLabel } from "@/lib/modelOptions";
import { formatThreadDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Thread } from "@/types/db";

interface ThreadRowProps {
  thread: Thread;
  active: boolean;
  /** Navigate to this thread (the parent wires the surrounding view changes). */
  onSelect: () => void;
  /** Last-message snippet for the "preview" row style (T35); undefined for
   *  empty threads or when the style doesn't need it. */
  snippet?: string;
}

/** One thread entry in the sidebar: select, double-click-to-rename, favorite
 *  star, and delete. Shared by the Chats and Projects panes. What the row
 *  shows below the title follows the Appearance "Chat list" style (T35). */
export function ThreadRow({
  thread,
  active,
  onSelect,
  snippet,
}: ThreadRowProps) {
  const t = useT();
  const locale = useIntlLocale();
  const rename = useThreads((s) => s.rename);
  const remove = useThreads((s) => s.remove);
  const toggleFavorite = useThreads((s) => s.toggleFavorite);
  const listStyle = useAppearance((s) => s.chatListStyle);
  const providers = useProviders();
  const models = useModels((s) => s.models);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);

  // Second line per row style (T35). null = single-line row ("title", or a
  // preview row whose thread has no messages yet).
  let subline: string | null = null;
  // Date formatting follows the active language (T32).
  const dateOpts = { locale, labels: timeLabels() };
  if (listStyle === "title-date") {
    subline = formatThreadDate(thread.updated_at, new Date(), dateOpts);
  } else if (listStyle === "detailed") {
    const { label, providerLabel } = currentModelLabel(
      providers,
      models,
      thread.provider,
      thread.model,
    );
    subline = `${formatThreadDate(thread.updated_at, new Date(), dateOpts)} · ${providerLabel} · ${label}`;
  } else if (listStyle === "preview") {
    subline = snippet ?? null;
  }

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
          className="flex min-w-0 flex-1 flex-col text-left"
          title={
            thread.ephemeral
              ? t("sidebar.incognitoRenameHint")
              : t("sidebar.renameHint")
          }
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            {/* Incognito badge (T29): session-only thread, purged on exit. */}
            {!!thread.ephemeral && (
              <Ghost
                className="text-muted-foreground size-3.5 shrink-0"
                aria-label={t("sidebar.incognitoBadge")}
              />
            )}
            <span
              className={cn(
                "truncate text-sm",
                !!thread.ephemeral && "text-muted-foreground italic",
              )}
            >
              {thread.title}
            </span>
          </span>
          {subline !== null && (
            <span className="text-muted-foreground w-full truncate text-xs">
              {subline}
            </span>
          )}
        </button>
      )}
      <button
        type="button"
        aria-label={
          fav ? t("sidebar.unfavoriteAria") : t("sidebar.favoriteAria")
        }
        title={fav ? t("sidebar.unfavorite") : t("sidebar.favorite")}
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
        aria-label={t("sidebar.deleteConversation")}
        onClick={() => {
          void confirmDialog({
            title: tNow("sidebar.deleteThreadTitle", { title: thread.title }),
            confirmText: tNow("common.delete"),
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
