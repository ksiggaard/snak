import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileText,
  FoldVertical,
  Globe,
  Wrench,
} from "lucide-react";
import {
  imageDataUrl,
  type MessageToolCall,
  type MessageView,
} from "@/lib/messages";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/Markdown";
import { useSearch } from "@/store/search";
import { useAppearance } from "@/store/appearance";
import { timeLabels, useIntlLocale, useT } from "@/store/i18n";
import {
  CHAT_CONTAINER_CLASSES,
  styleClasses,
  type ChatStyle,
} from "@/lib/appearance";
import { formatDuration, parseDbTime, relativeTime } from "@/lib/time";

interface MessageListProps {
  messages: MessageView[];
  pending?: boolean;
}

/**
 * A distinct, non-message indicator that the model invoked a tool (e.g. the
 * built-in web browser). Deliberately styled unlike a chat bubble — a bordered
 * pill with an icon and the fetched URL — so it reads as system chrome the model
 * itself can't produce, and makes it evident how the model found its answer.
 */
function ToolCallChip({ call }: { call: MessageToolCall }) {
  const t = useT();
  const isFetch = call.name === "web__fetch_url";
  const label = isFetch ? (call.url ?? t("chat.webPage")) : call.name;
  const Icon = isFetch ? Globe : Wrench;
  return (
    <div
      title={label}
      className="border-border bg-background/70 text-muted-foreground flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="text-foreground/90 truncate font-mono">{label}</span>
    </div>
  );
}

/** Small footer under an assistant reply: relative time + generation duration
 * + a copy-to-clipboard button for the whole reply. Hidden for the streaming
 * placeholder (empty created_at). `now` is supplied by the parent's ticker so
 * the relative label stays current. */
function AssistantMeta({
  createdAt,
  durationMs,
  now,
  content,
}: {
  createdAt: string;
  durationMs: number | null;
  now: number;
  /** The reply's raw Markdown, copied verbatim. */
  content: string;
}) {
  const t = useT();
  // Active-locale formatting (T32): labels + Intl locale follow the language.
  const locale = useIntlLocale();
  const [copied, setCopied] = useState(false);
  if (!createdAt) return null;
  const date = parseDbTime(createdAt);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (e.g. no permission); ignore silently.
    }
  };

  return (
    <div
      className="text-muted-foreground flex items-center gap-1.5 text-xs"
      title={date.toLocaleString(locale)}
    >
      <span>
        {relativeTime(date, new Date(now), timeLabels(), locale)}
        {durationMs != null && ` · ${formatDuration(durationMs)}`}
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? t("chat.copied") : t("chat.copy")}
        title={copied ? t("chat.copied") : t("chat.copy")}
        className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

/** One normal (non-summary) chat message, rendered per the active chat style.
 * Presentation only — images, tool chips, Markdown body, and the assistant
 * meta footer are identical across styles. */
function ChatMessage({
  m,
  chatStyle,
  flashed,
  now,
  innerRef,
}: {
  m: MessageView;
  chatStyle: ChatStyle;
  flashed: boolean;
  now: number;
  innerRef: (el: HTMLDivElement | null) => void;
}) {
  const t = useT();
  const isUser = m.role === "user";

  const images = m.images.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {m.images.map((img, i) => (
        <img
          key={i}
          src={imageDataUrl(img)}
          alt={t("chat.attachment")}
          className="max-h-48 rounded-md"
        />
      ))}
    </div>
  );
  // Document attachments (T39) — rendered alongside images, so they appear in
  // every chat style (each style branch below includes {docs}). No click
  // action in v1: the stored payload is the *extracted text* (which already
  // travels inside the message context), not the original file, so there's
  // nothing meaningful to open or download yet.
  const docs = m.documents.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {m.documents.map((d, i) => (
        <div
          key={i}
          title={d.name}
          className="bg-muted/40 text-muted-foreground flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
        >
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="text-foreground/90 truncate">{d.name}</span>
          <span className="shrink-0">
            {t("document.chars", { n: d.text.length.toLocaleString() })}
          </span>
        </div>
      ))}
    </div>
  );
  const tools = m.role === "assistant" && m.toolCalls.length > 0 && (
    <div className="flex flex-col items-start gap-1">
      {m.toolCalls.map((tc, i) => (
        <ToolCallChip key={i} call={tc} />
      ))}
    </div>
  );
  const body =
    m.content &&
    (m.role === "assistant" ? (
      // Assistant text is Markdown (GFM + highlighted code fences).
      // react-markdown tolerates partial/unclosed Markdown, so this
      // is safe to render against the growing streaming placeholder.
      <Markdown content={m.content} />
    ) : (
      <span className="whitespace-pre-wrap">{m.content}</span>
    ));
  const meta = m.role === "assistant" && (
    <AssistantMeta
      createdAt={m.created_at}
      durationMs={m.duration_ms}
      now={now}
      content={m.content}
    />
  );
  const flashRing = flashed && "ring-primary rounded-lg ring-2 ring-offset-2";

  if (chatStyle === "compact") {
    // Dense IRC-like row: a fixed-width role gutter, then the text. Markdown
    // margins are tightened by the `.chat-style-compact` rules in index.css.
    return (
      <div ref={innerRef} data-mid={m.id} className="flex scroll-mt-4">
        <div
          className={cn(
            // chat-content: hook for the custom chat font/size overrides
            // (T33, src/lib/appearance.ts) — no styling unless customized.
            "chat-content flex w-full max-w-full gap-2 text-sm",
            flashRing,
          )}
        >
          <span
            className={cn(
              "w-10 shrink-0 text-right text-xs leading-5 font-semibold select-none",
              isUser ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden
          >
            {isUser ? t("chat.you") : t("chat.ai")}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {images}
            {docs}
            {tools}
            {body}
            {meta}
          </div>
        </div>
      </div>
    );
  }

  if (chatStyle === "cozy") {
    // Slack/Discord-style: a round avatar monogram and a bold role name above
    // each message, everything left-aligned.
    return (
      <div ref={innerRef} data-mid={m.id} className="flex scroll-mt-4 gap-2.5">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold uppercase select-none",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {(isUser ? t("chat.you") : t("chat.ai")).slice(0, 1)}
        </span>
        <div
          className={cn(
            "chat-content flex min-w-0 flex-1 flex-col gap-1 text-sm",
            flashRing,
          )}
        >
          <span
            className={cn(
              "text-xs leading-7 font-semibold capitalize",
              isUser ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden
          >
            {isUser ? t("chat.you") : t("chat.ai")}
          </span>
          {images}
          {docs}
          {tools}
          {body}
          {meta}
        </div>
      </div>
    );
  }

  if (chatStyle === "terminal") {
    // CLI-session look: everything monospace; user messages read as typed
    // commands (a ❯ prompt, accent-colored text), assistant replies as plain
    // output. Markdown rhythm is tightened by the same index.css rules as
    // compact.
    return (
      <div ref={innerRef} data-mid={m.id} className="flex scroll-mt-4">
        <div
          className={cn(
            "chat-content flex w-full max-w-full gap-2 font-mono text-sm",
            isUser && "text-primary",
            flashRing,
          )}
        >
          {isUser && (
            <span className="shrink-0 font-bold select-none" aria-hidden>
              ❯
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {images}
            {docs}
            {tools}
            {body}
            {meta}
          </div>
        </div>
      </div>
    );
  }

  const { row, content } = styleClasses(chatStyle, isUser);
  return (
    <div ref={innerRef} data-mid={m.id} className={cn("flex scroll-mt-4", row)}>
      <div
        className={cn(
          // chat-content: hook for the custom chat font/size overrides
          // (T33, src/lib/appearance.ts) — no styling unless customized.
          "chat-content flex flex-col gap-2",
          content,
          flashRing,
        )}
      >
        {images}
        {docs}
        {tools}
        {body}
        {meta}
      </div>
    </div>
  );
}

export function MessageList({ messages, pending }: MessageListProps) {
  const t = useT();
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollToMessageId = useSearch((s) => s.scrollToMessageId);
  const consumeScroll = useSearch((s) => s.consumeScroll);
  // How messages render (T34): default / bubbles / compact / document.
  const chatStyle = useAppearance((s) => s.chatStyle);
  // Message briefly highlighted after jumping to it from a search result.
  const [flashId, setFlashId] = useState<string | null>(null);

  // Drives re-render of relative timestamps so "2m ago" advances on its own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // When a search-result / chat-panel jump targets a message, scroll to +
  // flash it instead of the bottom. Consuming the target re-runs this effect
  // with null — skipNextBottom keeps that re-run from yanking the view back
  // down to the bottom (the in-thread scroll-spy case).
  const skipNextBottom = useRef(false);
  useEffect(() => {
    if (scrollToMessageId) {
      const el = messageRefs.current.get(scrollToMessageId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashId(scrollToMessageId);
        const t = setTimeout(() => setFlashId(null), 2000);
        skipNextBottom.current = true;
        consumeScroll();
        return () => clearTimeout(t);
      }
      // Target not found (e.g. messages still loading) — consume to avoid a
      // stale jump on the next render.
      consumeScroll();
    }
    if (skipNextBottom.current) {
      skipNextBottom.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, scrollToMessageId, consumeScroll]);

  if (messages.length === 0 && !pending) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t("chat.empty")}
      </div>
    );
  }

  return (
    <div
      // data-chat-scroll: the chat panel's scroll spy uses this container as
      // its IntersectionObserver root (src/components/chat/ChatPanel.tsx).
      data-chat-scroll
      className={cn(
        "flex flex-1 flex-col overflow-y-auto",
        // Style hook consumed by the T34 rules in index.css (bubble break-out,
        // compact/terminal Markdown spacing).
        `chat-style-${chatStyle}`,
        CHAT_CONTAINER_CLASSES[chatStyle],
      )}
    >
      {messages.map((m) =>
        m.kind === "summary" ? (
          // Compaction point (T28): a divider, not a chat bubble. The summary
          // text is kept available behind a disclosure — the API context for
          // later turns starts here, but the full transcript above remains.
          <div
            key={m.id}
            ref={(el) => {
              if (el) messageRefs.current.set(m.id, el);
              else messageRefs.current.delete(m.id);
            }}
            className={cn(
              "scroll-mt-4",
              flashId === m.id &&
                "ring-primary rounded-lg ring-2 ring-offset-2",
            )}
          >
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <div className="bg-border h-px flex-1" />
              <FoldVertical className="size-3 shrink-0" aria-hidden />
              <details className="min-w-0">
                <summary className="cursor-pointer select-none">
                  {t("chat.compacted")}
                </summary>
                <div className="bg-muted/40 text-foreground/90 mt-2 rounded-md border p-3 text-sm">
                  <Markdown content={m.content} />
                </div>
              </details>
              <div className="bg-border h-px flex-1" />
            </div>
          </div>
        ) : (
          <ChatMessage
            key={m.id}
            m={m}
            chatStyle={chatStyle}
            flashed={flashId === m.id}
            now={now}
            innerRef={(el) => {
              if (el) messageRefs.current.set(m.id, el);
              else messageRefs.current.delete(m.id);
            }}
          />
        ),
      )}
      {pending && (
        <div className="flex justify-start">
          <div className="text-muted-foreground text-sm">
            {t("chat.thinking")}
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
