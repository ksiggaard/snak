import { useEffect, useRef, useState } from "react";
import { Globe, Wrench } from "lucide-react";
import {
  imageDataUrl,
  type MessageToolCall,
  type MessageView,
} from "@/lib/messages";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/Markdown";
import { useSearch } from "@/store/search";
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
  const isFetch = call.name === "web__fetch_url";
  const label = isFetch ? (call.url ?? "web page") : call.name;
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

/** Small footer under an assistant reply: relative time + generation duration.
 * Hidden for the streaming placeholder (empty created_at). `now` is supplied by
 * the parent's ticker so the relative label stays current. */
function AssistantMeta({
  createdAt,
  durationMs,
  now,
}: {
  createdAt: string;
  durationMs: number | null;
  now: number;
}) {
  if (!createdAt) return null;
  const date = parseDbTime(createdAt);
  return (
    <div
      className="text-muted-foreground text-xs"
      title={date.toLocaleString()}
    >
      {relativeTime(date, new Date(now))}
      {durationMs != null && ` · ${formatDuration(durationMs)}`}
    </div>
  );
}

export function MessageList({ messages, pending }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollToMessageId = useSearch((s) => s.scrollToMessageId);
  const consumeScroll = useSearch((s) => s.consumeScroll);
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
        Send a message to start the conversation.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {messages.map((m) => (
        <div
          key={m.id}
          ref={(el) => {
            if (el) messageRefs.current.set(m.id, el);
            else messageRefs.current.delete(m.id);
          }}
          className={cn(
            "flex scroll-mt-4",
            m.role === "user" ? "justify-end" : "justify-start",
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-2 text-sm",
              m.role === "user"
                ? "bg-primary text-primary-foreground max-w-[80%] rounded-lg px-3 py-2"
                : "text-foreground w-full max-w-full",
              flashId === m.id && "ring-primary rounded-lg ring-2 ring-offset-2",
            )}
          >
            {m.images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {m.images.map((img, i) => (
                  <img
                    key={i}
                    src={imageDataUrl(img)}
                    alt="attachment"
                    className="max-h-48 rounded-md"
                  />
                ))}
              </div>
            )}
            {m.role === "assistant" && m.toolCalls.length > 0 && (
              <div className="flex flex-col items-start gap-1">
                {m.toolCalls.map((tc, i) => (
                  <ToolCallChip key={i} call={tc} />
                ))}
              </div>
            )}
            {m.content &&
              (m.role === "assistant" ? (
                // Assistant text is Markdown (GFM + highlighted code fences).
                // react-markdown tolerates partial/unclosed Markdown, so this
                // is safe to render against the growing streaming placeholder.
                <Markdown content={m.content} />
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              ))}
            {m.role === "assistant" && (
              <AssistantMeta
                createdAt={m.created_at}
                durationMs={m.duration_ms}
                now={now}
              />
            )}
          </div>
        </div>
      ))}
      {pending && (
        <div className="flex justify-start">
          <div className="text-muted-foreground text-sm">Thinking…</div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
