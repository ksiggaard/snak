import { useEffect, useRef, useState } from "react";
import { Check, Copy, FoldVertical, Globe, Wrench } from "lucide-react";
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
import type { ChatStyle } from "@/lib/appearance";
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

/** Per-chat-style classes for the message row + its content wrapper (T34).
 * Compact has its own markup (gutter prefix) and doesn't use this table. */
function styleClasses(
  style: ChatStyle,
  isUser: boolean,
): { row: string; content: string } {
  switch (style) {
    case "bubbles":
      // Messenger-style. The assistant bubble carries `bubble-assistant` so
      // wide content (code/tables) lets it break out of the 75% cap — see the
      // `:has(pre, table)` rule in index.css — instead of squishing.
      return {
        row: isUser ? "justify-end" : "justify-start",
        content: isUser
          ? "bg-primary/10 max-w-[75%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm"
          : "bubble-assistant bg-muted text-foreground max-w-[75%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm",
      };
    case "document":
      // Reading mode: user prompts as section headings/quotes, assistant
      // prose flows full-width like an article.
      return {
        row: "justify-start",
        content: isUser
          ? "border-primary/60 w-full max-w-full border-l-2 py-0.5 pl-3 text-base font-semibold"
          : "text-foreground w-full max-w-full text-sm",
      };
    default:
      // "default": the original flat full-width layout, unchanged.
      return {
        row: isUser ? "justify-end" : "justify-start",
        content: isUser
          ? "bg-primary text-primary-foreground max-w-[80%] rounded-lg px-3 py-2 text-sm"
          : "text-foreground w-full max-w-full text-sm",
      };
  }
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
      <div ref={innerRef} className="flex scroll-mt-4">
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
    <div ref={innerRef} className={cn("flex scroll-mt-4", row)}>
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

  // When a search result is opened, scroll to + flash the matched message
  // instead of jumping to the bottom. Falls back to the bottom otherwise.
  useEffect(() => {
    if (scrollToMessageId) {
      const el = messageRefs.current.get(scrollToMessageId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashId(scrollToMessageId);
        const t = setTimeout(() => setFlashId(null), 2000);
        consumeScroll();
        return () => clearTimeout(t);
      }
      // Target not found (e.g. messages still loading) — consume to avoid a
      // stale jump on the next render.
      consumeScroll();
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
      className={cn(
        "flex flex-1 flex-col overflow-y-auto",
        // Style hook consumed by the T34 rules in index.css (bubble break-out,
        // compact Markdown spacing).
        `chat-style-${chatStyle}`,
        chatStyle === "compact"
          ? "gap-1 p-2"
          : chatStyle === "document"
            ? "gap-6 p-4"
            : "gap-4 p-4",
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
