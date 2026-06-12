import { useState } from "react";
import { Ghost, PanelRight } from "lucide-react";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Button } from "@/components/ui/button";
import { useThreads } from "@/store/threads";
import { useT } from "@/store/i18n";
import { useProviders } from "@/lib/providers";

export function ChatView() {
  const t = useT();
  // Right-side chat panel (media / scroll spy / in-chat search / token
  // spend). Hidden by default, per-session only — not persisted.
  const [panelOpen, setPanelOpen] = useState(false);
  const messages = useThreads((s) => s.messages);
  const busy = useThreads((s) => s.busy);
  const error = useThreads((s) => s.error);
  const send = useThreads((s) => s.send);
  const cancel = useThreads((s) => s.cancel);
  const currentThreadId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);
  const draftIncognito = useThreads((s) => s.draftIncognito);

  // Active providers from the enabled provider plugins (T18).
  const providers = useProviders();

  // Provider in effect for the active thread (or the draft when unsaved) —
  // mirrors ModelPicker so the key-gating in Composer matches what will be used.
  const current = threads.find((t) => t.id === currentThreadId);
  const provider = current?.provider ?? draftProvider;

  // Incognito (T29): the saved thread's flag, or the draft flag while unsaved.
  const incognito = current ? !!current.ephemeral : draftIncognito;

  // The effective provider may be disabled (all providers off, or this thread
  // references a since-disabled one). Composer gates Send on this with guidance.
  const providerEnabled = providers.some((p) => p.id === provider);
  const anyProvider = providers.length > 0;

  // Show "Thinking…" only until the first streamed token arrives; after that
  // the growing assistant bubble conveys progress.
  const last = messages[messages.length - 1];
  const pending = busy && (!last || last.role === "user");

  return (
    <div className="relative flex flex-1 flex-row overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
        <MessageList messages={messages} pending={pending} />
        {error && <p className="text-destructive px-1 text-sm">{error}</p>}
        {incognito && (
          <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
            <Ghost className="size-3.5 shrink-0" aria-hidden />
            {t("chat.incognitoHint")}
          </p>
        )}
        <Composer
          onSend={(text, images) => void send(text, images)}
          onCancel={() => void cancel()}
          busy={busy}
          provider={provider}
          providerEnabled={providerEnabled}
          anyProvider={anyProvider}
        />
      </div>
      {!panelOpen && (
        // In-flow slim strip (mirrors the sidebar's reopen bar) so the toggle
        // never overlaps messages or crowds the composer.
        <div className="hidden w-9 shrink-0 flex-col items-center pt-0.5 md:flex">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("panel.open")}
            title={t("panel.open")}
            onClick={() => setPanelOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <PanelRight className="size-4" />
          </Button>
        </div>
      )}
      {panelOpen && (
        <ChatPanel
          messages={messages}
          threadId={currentThreadId}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}
