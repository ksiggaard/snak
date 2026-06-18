import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Ghost, PanelRight, ShieldAlert } from "lucide-react";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Button } from "@/components/ui/button";
import { useThreads } from "@/store/threads";
import { useBots } from "@/store/bots";
import { useKeys } from "@/store/keys";
import { useAppearance } from "@/store/appearance";
import { useT } from "@/store/i18n";
import { isKeylessProvider, useProviders } from "@/lib/providers";
import { CHAT_X_PADDING } from "@/lib/appearance";
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

/** Per-call approval gate for the read-only system-diagnostics tool: shows the
 * exact action (path or resolved command) and where the result will go, and
 * runs nothing until the user allows it. Mirrors the Composer's terminal-staging
 * confirmation. */
function ApprovalGate({
  providerLabel,
  local,
}: {
  providerLabel: string;
  local: boolean;
}) {
  const t = useT();
  const pending = useThreads((s) => s.pendingApproval);
  const resolve = useThreads((s) => s.resolveApproval);
  if (!pending) return null;
  return (
    <div className="border-primary/40 bg-muted/40 flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 shrink-0" aria-hidden />
        {t("chat.approvalTitle")}
      </div>
      <p className="text-muted-foreground text-xs">
        {t("chat.approvalExplain")}
      </p>
      <div className="text-muted-foreground text-xs font-medium">
        {pending.summary}
      </div>
      <div
        className={cn(
          "text-xs font-medium",
          local ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {local
          ? t("chat.approvalDestLocal", { provider: providerLabel })
          : t("chat.approvalDestCloud", { provider: providerLabel })}
      </div>
      <pre className="bg-background overflow-x-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap">
        {pending.detail}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => resolve(true)}>
          {t("chat.approve")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => resolve(true, true)}
        >
          {t("chat.approveAll")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => resolve(false)}>
          {t("chat.deny")}
        </Button>
      </div>
    </div>
  );
}

/** Planner mode toggle bar: shown above the composer when at least two distinct
 *  models are available. Lets the user toggle planner orchestration on/off for
 *  the current chat. */
function PlannerToggleBar() {
  const t = useT();
  const currentThreadId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftUsePlanner = useThreads((s) => s.draftUsePlanner);
  const setUsePlanner = useThreads((s) => s.setUsePlanner);
  const providers = useProviders();
  const present = useKeys((s) => s.present);

  // Only show when ≥2 distinct providers are keyed (planner needs choices).
  const keyedCount = providers.filter(
    (p) => isKeylessProvider(p.id) || present.has(p.id),
  ).length;
  if (keyedCount < 2) return null;

  const thread = threads.find((t) => t.id === currentThreadId);
  const plannerActive = currentThreadId
    ? (thread?.planner_active ?? 0) !== 0
    : draftUsePlanner;

  return (
    <div className="flex items-center justify-center">
      <button
        type="button"
        onClick={() => void setUsePlanner(!plannerActive)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
          plannerActive
            ? "bg-primary/10 text-primary hover:bg-primary/15"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        title={t(plannerActive ? "planner.toggleOn" : "planner.toggleOff")}
      >
        <Brain className="size-3.5 shrink-0" />
        <span>{t("planner.title")}</span>
      </button>
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
  const draftModel = useThreads((s) => s.draftModel);
  const draftIncognito = useThreads((s) => s.draftIncognito);
  const draftBotId = useThreads((s) => s.draftBotId);
  const chatMaxWidth = useAppearance((s) => s.chatMaxWidth);
  // Mirror the message scroll-container's horizontal padding so the composer
  // column lines up with the message column (which is inset by that padding).
  const chatStyle = useAppearance((s) => s.chatStyle);

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
  const model = current?.model ?? draftModel;

  // Incognito (T29): the saved thread's flag, or the draft flag while unsaved.
  const incognito = current ? !!current.ephemeral : draftIncognito;

  // Bot persona (T38): the saved thread's bot, or the draft bot while unsaved.
  const botId = current ? current.bot_id : draftBotId;
  const bot = botId ? (bots.find((b) => b.id === botId) ?? null) : null;

  // The effective provider may be disabled (all providers off, or this thread
  // references a since-disabled one). Composer gates Send on this with guidance.
  const providerEnabled = providers.some((p) => p.id === provider);
  const anyProvider = providers.length > 0;

  // Where an approved system-diagnostics result will go: local models keep it
  // on the machine; cloud providers receive it. Surfaced on the approval card.
  const providerLabel =
    providers.find((p) => p.id === provider)?.label ?? provider;
  const providerLocal = isKeylessProvider(provider);

  // Show "Thinking…" until the first streamed token arrives (after that the
  // growing assistant bubble conveys progress), and again in the gap after a
  // tool call finishes while the model composes its follow-up — so a slow
  // post-tool round doesn't look like the persona stopped responding.
  const last = messages[messages.length - 1];
  const awaitingModel = useThreads((s) => s.awaitingModel);
  const pending = busy && (!last || last.role === "user" || awaitingModel);

  return (
    <div className="relative flex flex-1 flex-row gap-4 overflow-hidden">
      <motion.div
        layout
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-4 overflow-hidden",
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
        <div
          // Match the message column's inset: the same base horizontal padding
          // as the message scroll container, plus — on the right — the width of
          // that container's reserved scrollbar gutter (`--snak-scrollbar-width`),
          // so the centered composer lines up with the centered messages whether
          // the width cap is on or off, and whether or not the chat is scrolling.
          style={{
            paddingLeft: CHAT_X_PADDING[chatStyle],
            paddingRight: `calc(${CHAT_X_PADDING[chatStyle]} + var(--snak-scrollbar-width, 0px))`,
          }}
        >
          <div
            className="mx-auto flex w-full flex-col gap-4"
            style={{ maxWidth: chatMaxWidth ? chatMaxWidth + 40 : undefined }}
          >
            {error && <p className="text-destructive px-1 text-sm">{error}</p>}
            <PlannerToggleBar />
            <ApprovalGate providerLabel={providerLabel} local={providerLocal} />
            <Composer
              onSend={(text, images, documents) =>
                void send(text, images, documents)
              }
              onCancel={() => void cancel()}
              busy={busy}
              provider={provider}
              model={model}
              providerEnabled={providerEnabled}
              anyProvider={anyProvider}
            />
          </div>
        </div>
      </motion.div>
      <AnimatePresence mode="popLayout">
        {!panelOpen && (
          <motion.div
            key="panel-toggle"
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="hidden w-9 shrink-0 flex-col items-center pt-0.5 md:flex"
          >
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
          </motion.div>
        )}
        {panelOpen && (
          <ChatPanel
            key="chat-panel"
            messages={messages}
            threadId={currentThreadId}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
