import { useEffect, useMemo, useState } from "react";
import {
  Coins,
  CornerDownLeft,
  Image as ImageIcon,
  ListOrdered,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  mediaEntries,
  searchChatMessages,
  userMessageEntries,
  type MediaEntry,
} from "@/lib/chatPanel";
import { NativeSelect } from "@/components/NativeSelect";
import { threadUsageTotals, type ThreadUsageTotals } from "@/lib/db";
import { imageDataUrl, type MessageView } from "@/lib/messages";
import { highlightSegments } from "@/lib/search";
import { formatTokens } from "@/lib/usage";
import { useProjects } from "@/store/projects";
import { useSearch } from "@/store/search";
import { useThreads } from "@/store/threads";
import { useT } from "@/store/i18n";

/**
 * Right-side chat panel (hidden by default): in-chat text search, a scroll
 * spy over the user's own messages, every image shared in the thread, and the
 * thread's summed token spend. All jumps reuse the T19 scroll-to + flash
 * mechanism via `useSearch.requestScroll`.
 */
export function ChatPanel({
  messages,
  threadId,
  onClose,
}: {
  messages: MessageView[];
  threadId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const requestScroll = useSearch((s) => s.requestScroll);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [totals, setTotals] = useState<ThreadUsageTotals | null>(null);
  const [lightbox, setLightbox] = useState<MediaEntry | null>(null);

  const userEntries = useMemo(() => userMessageEntries(messages), [messages]);
  const media = useMemo(() => mediaEntries(messages), [messages]);
  const hits = useMemo(
    () => searchChatMessages(messages, query),
    [messages, query],
  );

  // Token spend: re-summed when the thread changes or a reply lands.
  useEffect(() => {
    let stale = false;
    if (!threadId) {
      setTotals(null);
      return;
    }
    threadUsageTotals(threadId)
      .then((u) => {
        if (!stale) setTotals(u);
      })
      .catch(() => {
        if (!stale) setTotals(null);
      });
    return () => {
      stale = true;
    };
  }, [threadId, messages.length]);

  // Scroll spy: observe the user's message rows inside the message-list
  // scroll container; the topmost visible one (in message order) is active.
  useEffect(() => {
    const container = document.querySelector("[data-chat-scroll]");
    if (!container || userEntries.length === 0) return;
    const userIds = new Set(userEntries.map((u) => u.id));
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.mid;
          if (!id) continue;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = userEntries.find((u) => visible.has(u.id));
        if (first) setActiveId(first.id);
      },
      { root: container, threshold: 0.1 },
    );
    for (const el of container.querySelectorAll<HTMLElement>("[data-mid]")) {
      if (el.dataset.mid && userIds.has(el.dataset.mid)) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [userEntries]);

  return (
    <aside className="border-border bg-background hidden w-72 shrink-0 flex-col overflow-hidden border-l md:flex">
      <div className="flex items-center gap-2 border-b p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("panel.searchPlaceholder")}
          className="h-8"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("panel.close")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {query.trim() ? (
          <Section title={t("panel.results")}>
            {hits.length === 0 ? (
              <Empty text={t("panel.noMatches")} />
            ) : (
              hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => requestScroll(h.id)}
                  className="hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-xs"
                >
                  <Snippet text={h.snippet} query={query} />
                </button>
              ))
            )}
          </Section>
        ) : (
          <>
            {threadId && <ThreadSection threadId={threadId} />}
            <Section
              title={t("panel.myMessages")}
              icon={<ListOrdered className="size-3.5" aria-hidden />}
            >
              {userEntries.length === 0 ? (
                <Empty text={t("panel.noMessages")} />
              ) : (
                userEntries.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => requestScroll(u.id)}
                    className={cn(
                      "w-full truncate rounded-md border-l-2 px-2 py-1.5 text-left text-xs transition-colors",
                      activeId === u.id
                        ? "border-primary bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 border-transparent",
                    )}
                  >
                    {u.label || "…"}
                  </button>
                ))
              )}
            </Section>

            <Section
              title={t("panel.media")}
              icon={<ImageIcon className="size-3.5" aria-hidden />}
            >
              {media.length === 0 ? (
                <Empty text={t("panel.noMedia")} />
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {media.map((entry, i) => (
                    <button
                      key={`${entry.messageId}-${i}`}
                      type="button"
                      onClick={() => setLightbox(entry)}
                      className="focus-visible:ring-ring overflow-hidden rounded-md focus-visible:ring-2"
                    >
                      <img
                        src={imageDataUrl(entry.image)}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      {totals !== null && totals.total_tokens > 0 && (
        <div
          className="text-muted-foreground flex items-center gap-1.5 border-t px-3 py-2 text-xs"
          title={`${totals.input_tokens.toLocaleString()} in · ${totals.output_tokens.toLocaleString()} out · ${totals.cache_tokens.toLocaleString()} cache`}
        >
          <Coins className="size-3.5 shrink-0" aria-hidden />
          <span className="font-medium">{t("panel.tokenSpend")}</span>
          <span className="ml-auto tabular-nums">
            ↓ {formatTokens(totals.input_tokens)} · ↑{" "}
            {formatTokens(totals.output_tokens)}
          </span>
        </div>
      )}

      {lightbox && (
        <Lightbox
          entry={lightbox}
          onClose={() => setLightbox(null)}
          onGoToMessage={() => {
            requestScroll(lightbox.messageId);
            setLightbox(null);
          }}
        />
      )}
    </aside>
  );
}

/** Full-size view of a shared image: backdrop/Esc/X to close, plus a jump to
 * the message it was sent with. */
function Lightbox({
  entry,
  onClose,
  onGoToMessage,
}: {
  entry: MediaEntry;
  onClose: () => void;
  onGoToMessage: () => void;
}) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <img
        src={imageDataUrl(entry.image)}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[82vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
      <div
        className="flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Button variant="secondary" size="sm" onClick={onGoToMessage}>
          <CornerDownLeft className="size-4" />
          {t("panel.goToMessage")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-label={t("panel.close")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Chat management for the open thread: rename and move to a project. */
function ThreadSection({ threadId }: { threadId: string }) {
  const t = useT();
  const thread = useThreads((s) => s.threads.find((x) => x.id === threadId));
  const rename = useThreads((s) => s.rename);
  const assignThreadProject = useThreads((s) => s.assignThreadProject);
  const projects = useProjects((s) => s.projects);
  const projectsInitialized = useProjects((s) => s.initialized);
  const initProjects = useProjects((s) => s.init);
  const [title, setTitle] = useState(thread?.title ?? "");
  // Re-seed the local draft when switching threads (render-time adjustment).
  const [seededFor, setSeededFor] = useState(threadId);
  if (seededFor !== threadId) {
    setSeededFor(threadId);
    setTitle(thread?.title ?? "");
  }

  useEffect(() => {
    if (!projectsInitialized) void initProjects();
  }, [projectsInitialized, initProjects]);

  if (!thread) return null;

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== thread.title) void rename(threadId, next);
    else setTitle(thread.title);
  };

  return (
    <Section title={t("panel.chatSection")}>
      <div className="flex flex-col gap-2 px-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setTitle(thread.title);
          }}
          placeholder={t("panel.renamePlaceholder")}
          aria-label={t("panel.renamePlaceholder")}
          className="h-8 text-sm"
        />
        {projects.length > 0 && (
          <label className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {t("panel.project")}
            </span>
            <NativeSelect
              className="h-8 w-40"
              value={thread.project_id ?? ""}
              onChange={(e) =>
                void assignThreadProject(threadId, e.target.value || null)
              }
            >
              <option value="">{t("panel.noProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>
    </Section>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-muted-foreground flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-muted-foreground px-2 text-xs">{text}</p>;
}

/** Search snippet with the matched terms highlighted. */
function Snippet({ text, query }: { text: string; query: string }) {
  return (
    <span className="text-foreground/90 line-clamp-2">
      {highlightSegments(text, query).map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="bg-primary/25 text-foreground rounded px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}
