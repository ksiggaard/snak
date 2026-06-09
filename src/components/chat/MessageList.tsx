import { useEffect, useRef, useState } from "react";
import { imageDataUrl, type MessageView } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/Markdown";
import { useSearch } from "@/store/search";

interface MessageListProps {
  messages: MessageView[];
  pending?: boolean;
}

export function MessageList({ messages, pending }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollToMessageId = useSearch((s) => s.scrollToMessageId);
  const consumeScroll = useSearch((s) => s.consumeScroll);
  // Message briefly highlighted after jumping to it from a search result.
  const [flashId, setFlashId] = useState<string | null>(null);

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
              "flex max-w-[80%] flex-col gap-2 rounded-lg px-3 py-2 text-sm transition-shadow",
              m.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
              flashId === m.id && "ring-primary ring-2 ring-offset-2",
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
            {m.content &&
              (m.role === "assistant" ? (
                // Assistant text is Markdown (GFM + highlighted code fences).
                // react-markdown tolerates partial/unclosed Markdown, so this
                // is safe to render against the growing streaming placeholder.
                <Markdown content={m.content} />
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              ))}
          </div>
        </div>
      ))}
      {pending && (
        <div className="flex justify-start">
          <div className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-sm">
            Thinking…
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
