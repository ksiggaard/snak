import { useEffect, useState } from "react";
import {
  FolderInput,
  Ghost,
  MoreHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/store/projects";
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
  const setArchived = useThreads((s) => s.setArchived);
  const assignThreadProject = useThreads((s) => s.assignThreadProject);
  const projects = useProjects((s) => s.projects);
  const projectsInitialized = useProjects((s) => s.initialized);
  const initProjects = useProjects((s) => s.init);

  // The move-to-project submenu needs the project list even when the
  // Projects pane was never opened this session.
  useEffect(() => {
    if (!projectsInitialized) void initProjects();
  }, [projectsInitialized, initProjects]);
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
            {/* Favorite indicator — the toggle itself lives in the row menu. */}
            {fav && (
              <Star
                className="size-3 shrink-0 fill-yellow-500 text-yellow-500"
                aria-label={t("sidebar.favorites")}
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("sidebar.chatMenu")}
            title={t("sidebar.chatMenu")}
            className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => void toggleFavorite(thread.id)}>
            <Star className={cn(fav && "fill-yellow-500 text-yellow-500")} />
            {fav ? t("sidebar.unfavorite") : t("sidebar.favorite")}
          </DropdownMenuItem>
          {projects.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput />
                {t("sidebar.moveToProject")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  disabled={thread.project_id === null}
                  onClick={() => void assignThreadProject(thread.id, null)}
                >
                  {t("panel.noProject")}
                </DropdownMenuItem>
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    disabled={thread.project_id === p.id}
                    onClick={() => void assignThreadProject(thread.id, p.id)}
                  >
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              void confirmDialog({
                title: tNow("sidebar.deleteThreadTitle", {
                  title: thread.title,
                }),
                confirmText: tNow("common.delete"),
                destructive: true,
              }).then((ok) => {
                if (ok) void remove(thread.id);
              });
            }}
          >
            <Trash2 />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!thread.archived && (
        <button
          type="button"
          aria-label={t("sidebar.archiveChat")}
          title={t("sidebar.archiveChat")}
          onClick={() => void setArchived(thread.id, true)}
          className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
