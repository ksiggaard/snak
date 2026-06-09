import { useEffect, useRef } from "react";
import { imageDataUrl, type MessageView } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/Markdown";

interface MessageListProps {
  messages: MessageView[];
  pending?: boolean;
}

export function MessageList({ messages, pending }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

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
          className={cn(
            "flex",
            m.role === "user" ? "justify-end" : "justify-start",
          )}
        >
          <div
            className={cn(
              "flex max-w-[80%] flex-col gap-2 rounded-lg px-3 py-2 text-sm",
              m.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
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
