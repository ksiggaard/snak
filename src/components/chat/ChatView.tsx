import { useEffect, useState } from "react";
import { Ghost, PanelRight } from "lucide-react";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Button } from "@/components/ui/button";
import { useThreads } from "@/store/threads";
import { useBots } from "@/store/bots";
import { useT } from "@/store/i18n";
import { useProviders } from "@/lib/providers";
import { cn } from "@/lib/utils";

/** Pre-first-message explainer for an incognito chat (T36): states what the
 * mode does (session-only, purged on exit) and — just as importantly — what
 * it does NOT do: messages still go to the model's provider. */
function IncognitoExplainer() {
  const t = useT();
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
      <div className="border-muted-foreground/40 bg-muted/30 max-w-md rounded-xl border border-dashed p-6 text-center">
        <Ghost
          className="snak-ghost-float text-muted-foreground mx-auto size-10"
          aria-hidden
        />
        <h2 className="mt-3 text-base font-semibold">
          {t("chat.incognitoExplainerTitle")}
        </h2>
        <p className="text-muted-foreground mt-3 text-sm">
          {t("chat.incognitoExplainerIs")}
        </p>
        <p className="text-foreground/90 mt-3 text-sm font-medium">
          {t("chat.incognitoExplainerIsnt")}
        </p>
      </div>
    </div>
  );
}

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
  const draftBotId = useThreads((s) => s.draftBotId);

  // Bots (T38): needed to resolve the active thread's persona for rendering.
  // Lazy-init in case the Bots pane was never opened this session.
  const bots = useBots((s) => s.bots);
  const botsInitialized = useBots((s) => s.initialized);
  const initBots = useBots((s) => s.init);
  useEffect(() => {
    if (!botsInitialized) void initBots();
  }, [botsInitialized, initBots]);

  // Active providers from the enabled provider plugins (T18).
  const providers = useProviders();

  // Provider in effect for the active thread (or the draft when unsaved) —
  // mirrors ModelPicker so the key-gating in Composer matches what will be used.
  const current = threads.find((t) => t.id === currentThreadId);
  const provider = current?.provider ?? draftProvider;

  // Incognito (T29): the saved thread's flag, or the draft flag while unsaved.
  const incognito = current ? !!current.ephemeral : draftIncognito;

  // Bot persona (T38): the saved thread's bot, or the draft bot while unsaved.
  const botId = current ? current.bot_id : draftBotId;
  const bot = botId ? (bots.find((b) => b.id === botId) ?? null) : null;

  // The effective provider may be disabled (all providers off, or this thread
  // references a since-disabled one). Composer gates Send on this with guidance.
  const providerEnabled = providers.some((p) => p.id === provider);
  const anyProvider = providers.length > 0;

  // Show "Thinking…" only until the first streamed token arrives; after that
  // the growing assistant bubble conveys progress.
  const last = messages[messages.length - 1];
  const pending = busy && (!last || last.role === "user");

  return (
    <div className="relative flex flex-1 flex-row gap-3 overflow-hidden">
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 overflow-hidden",
          // Incognito identity (T36): the whole chat surface reads as a
          // distinct, temporary space — dashed border + muted tint.
          incognito &&
            "border-muted-foreground/40 bg-muted/20 rounded-lg border border-dashed p-2",
        )}
      >
        {incognito && (
          <div className="border-muted-foreground/40 bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs">
            <Ghost className="size-4 shrink-0" aria-hidden />
            <span className="text-foreground font-medium">
              {t("chat.incognitoHeader")}
            </span>
            <span className="hidden truncate sm:inline">
              {t("chat.incognitoHint")}
            </span>
          </div>
        )}
        {incognito && messages.length === 0 && !pending ? (
          <IncognitoExplainer />
        ) : (
          <MessageList messages={messages} pending={pending} bot={bot} />
        )}
        {error && <p className="text-destructive px-1 text-sm">{error}</p>}
        <Composer
          onSend={(text, images, documents) =>
            void send(text, images, documents)
          }
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
