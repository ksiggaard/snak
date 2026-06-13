import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { useBots } from "@/store/bots";
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
  const bots = useBots((s) => s.bots);
  const botsInitialized = useBots((s) => s.initialized);
  const initBots = useBots((s) => s.init);

  // The bot badge needs the bot list even when the Bots pane was never
  // opened this session (T38).
  useEffect(() => {
    if (!botsInitialized) void initBots();
  }, [botsInitialized, initBots]);
  const bot = thread.bot_id
    ? (bots.find((b) => b.id === thread.bot_id) ?? null)
    : null;
  const listStyle = useAppearance((s) => s.chatListStyle);
  const providers = useProviders();
  const models = useModels((s) => s.models);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  // Tracks whether the row's context menu is open, only so the action overlay
  // stays visible while it is (ContextMenu opens itself from the right-click).
  const [menuOpen, setMenuOpen] = useState(false);

  // The MoreHorizontal button opens the same context menu near the button:
  // synthesize a contextmenu event at its corner so it bubbles to the trigger
  // and Radix anchors the menu there (right-clicking the row anchors at the
  // cursor natively).
  function openMenuFromButton(e: ReactMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: rect.left,
        clientY: rect.bottom,
      }),
    );
  }

  // Per row style (T35): an optional second line under the title, an optional
  // right-aligned date on the title line, and an optional leading provider
  // monogram. null = not shown (e.g. a snippet row whose thread is empty).
  let subline: string | null = null;
  let trailingDate: string | null = null;
  let monogram: string | null = null;
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
  } else if (listStyle === "inline") {
    trailingDate = formatThreadDate(thread.updated_at, new Date(), dateOpts);
  } else if (listStyle === "full") {
    trailingDate = formatThreadDate(thread.updated_at, new Date(), dateOpts);
    subline = snippet ?? null;
  } else if (listStyle === "icon") {
    const { providerLabel } = currentModelLabel(
      providers,
      models,
      thread.provider,
      thread.model,
    );
    monogram = providerLabel.slice(0, 1).toUpperCase();
  }
  const compact = listStyle === "compact";

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
    <ContextMenu onOpenChange={setMenuOpen}>
      {/* Renaming owns the row; don't hijack right-click into the menu then. */}
      <ContextMenuTrigger asChild disabled={editing}>
        <div
          className={cn(
            "group relative flex items-center gap-1 rounded-md px-2",
            compact ? "py-0.5" : "py-1.5",
            active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
            // Incognito identity (T36): a dashed left edge + tint so the row
            // reads as temporary at a glance, beyond the Ghost badge.
            !!thread.ephemeral &&
              "border-muted-foreground/40 rounded-l-none border-l-2 border-dashed",
            !!thread.ephemeral && !active && "bg-muted/40",
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
                {/* Provider monogram for the "icon" row style (T35). */}
                {monogram !== null && (
                  <span
                    className="bg-primary/10 text-primary grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold select-none"
                    aria-hidden
                  >
                    {monogram}
                  </span>
                )}
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
                {/* Bot badge (T38): the persona's avatar before the title. */}
                {bot && (
                  <span
                    className="shrink-0"
                    title={t("sidebar.botBadge", { name: bot.name })}
                    aria-label={t("sidebar.botBadge", { name: bot.name })}
                  >
                    <BotAvatar bot={bot} className="size-4 shrink-0" />
                  </span>
                )}
                <span
                  className={cn(
                    "truncate",
                    compact ? "text-xs" : "text-sm",
                    !!thread.ephemeral && "text-muted-foreground italic",
                  )}
                >
                  {thread.title}
                </span>
                {/* Right-aligned date for the "inline" / "full" row styles. */}
                {trailingDate !== null && (
                  <span className="text-muted-foreground ml-auto shrink-0 pl-1 text-[10px] tabular-nums">
                    {trailingDate}
                  </span>
                )}
              </span>
              {subline !== null && (
                <span className="text-muted-foreground w-full truncate text-xs">
                  {subline}
                </span>
              )}
            </button>
          )}
          {/* Action buttons overlay the row's right edge instead of reserving
          flex space — invisible until hover (or while the menu is open), so
          the title gets the full width the rest of the time. A gradient
          backing keeps the icons legible over any text underneath. */}
          <div
            className={cn(
              "absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md pr-1 pl-6",
              "from-sidebar-accent via-sidebar-accent bg-gradient-to-l to-transparent",
              "opacity-0 transition-opacity group-hover:opacity-100",
              menuOpen && "opacity-100",
              editing && "hidden",
            )}
          >
            <button
              type="button"
              aria-label={t("sidebar.chatMenu")}
              title={t("sidebar.chatMenu")}
              onClick={openMenuFromButton}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <MoreHorizontal className="size-4" />
            </button>
            {!thread.archived && (
              <button
                type="button"
                aria-label={t("sidebar.archiveChat")}
                title={t("sidebar.archiveChat")}
                onClick={() => void setArchived(thread.id, true)}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => void toggleFavorite(thread.id)}>
          <Star className={cn(fav && "fill-yellow-500 text-yellow-500")} />
          {fav ? t("sidebar.unfavorite") : t("sidebar.favorite")}
        </ContextMenuItem>
        {projects.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput />
              {t("sidebar.moveToProject")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                disabled={thread.project_id === null}
                onClick={() => void assignThreadProject(thread.id, null)}
              >
                {t("panel.noProject")}
              </ContextMenuItem>
              {projects.map((p) => (
                <ContextMenuItem
                  key={p.id}
                  disabled={thread.project_id === p.id}
                  onClick={() => void assignThreadProject(thread.id, p.id)}
                >
                  {p.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
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
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
