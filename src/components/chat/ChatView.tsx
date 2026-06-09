import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { useThreads } from "@/store/threads";

export function ChatView() {
  const messages = useThreads((s) => s.messages);
  const busy = useThreads((s) => s.busy);
  const error = useThreads((s) => s.error);
  const send = useThreads((s) => s.send);
  const cancel = useThreads((s) => s.cancel);
  const currentThreadId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);

  // Provider in effect for the active thread (or the draft when unsaved) —
  // mirrors ModelPicker so the key-gating in Composer matches what will be used.
  const current = threads.find((t) => t.id === currentThreadId);
  const provider = current?.provider ?? draftProvider;

  // Show "Thinking…" only until the first streamed token arrives; after that
  // the growing assistant bubble conveys progress.
  const last = messages[messages.length - 1];
  const pending = busy && (!last || last.role === "user");

  return (
    <div className="bg-card flex flex-1 flex-col overflow-hidden rounded-lg border">
      <MessageList messages={messages} pending={pending} />
      {error && (
        <p className="text-destructive border-t px-4 py-2 text-sm">{error}</p>
      )}
      <Composer
        onSend={(text, images) => void send(text, images)}
        onCancel={() => void cancel()}
        busy={busy}
        provider={provider}
      />
    </div>
  );
}
