import { useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { useThreads } from "@/store/threads";
import { useQuickActions } from "@/store/quickActions";
import { useBots } from "@/store/bots";
import { useWorkspaces } from "@/store/workspaces";
import { resolveQuickActions, type QuickAction } from "@/lib/quickActions";
import { parseStarters } from "@/lib/bots";
import { useT } from "@/store/i18n";
import type { Bot } from "@/types/db";

/**
 * Empty new-chat screen: configurable quick actions plus "Chat with <persona>"
 * starters. Shown by MessageList in place of the bare empty-state text for a
 * plain (non-persona, non-incognito) draft. Reads the stores itself — it's only
 * mounted on the empty state, so the lazy inits here are cheap and idempotent.
 *
 * - A quick action's `mode` decides the click: `prefill` loads its prompt into
 *   the Composer (so the user adds their text), `send` fires it immediately.
 * - Quick actions resolve per chat: a project's own set overrides the global
 *   one; otherwise the global actions show.
 * - A persona chip turns the current draft into a chat with that persona.
 *
 * When the chat belongs to a persona (`bot`), it instead greets with that
 * persona's own conversation starters — opening lines that surface what the
 * persona is good at; clicking one sends it to kick off the conversation.
 */
export function EmptySuggestions({ bot }: { bot?: Bot | null }) {
  const t = useT();

  const globalActions = useQuickActions((s) => s.actions);
  const quickInitialized = useQuickActions((s) => s.initialized);
  const initQuick = useQuickActions((s) => s.init);

  const bots = useBots((s) => s.bots);
  const botsInitialized = useBots((s) => s.initialized);
  const initBots = useBots((s) => s.init);

  const workspaces = useWorkspaces((s) => s.workspaces);
  const workspacesInitialized = useWorkspaces((s) => s.initialized);
  const initWorkspaces = useWorkspaces((s) => s.init);

  const send = useThreads((s) => s.send);
  const insertIntoComposer = useThreads((s) => s.insertIntoComposer);
  const startNewChatWithBot = useThreads((s) => s.startNewChatWithBot);
  // The workspace the current draft / thread belongs to (for the override).
  const currentThreadId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftWorkspaceId = useThreads((s) => s.draftWorkspaceId);

  useEffect(() => {
    if (!quickInitialized) void initQuick();
    if (!botsInitialized) void initBots();
    if (!workspacesInitialized) void initWorkspaces();
  }, [
    quickInitialized,
    initQuick,
    botsInitialized,
    initBots,
    workspacesInitialized,
    initWorkspaces,
  ]);

  const workspaceId = currentThreadId
    ? (threads.find((x) => x.id === currentThreadId)?.workspace_id ?? null)
    : draftWorkspaceId;
  const workspaceJson =
    workspaces.find((w) => w.id === workspaceId)?.quick_actions ?? null;
  const actions = resolveQuickActions(globalActions, workspaceJson);

  function runAction(action: QuickAction) {
    if (action.mode === "send") {
      void send(action.prompt, [], []);
    } else {
      insertIntoComposer(action.prompt);
    }
  }

  // Persona chat: greet with the persona's own starters (its opening lines).
  if (bot) {
    const starters = parseStarters(bot.starters);
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
        <div className="flex w-full max-w-2xl flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <BotAvatar bot={bot} className="size-12 text-xl" />
            <span className="text-foreground text-lg font-semibold">
              {bot.name}
            </span>
            <span className="text-muted-foreground text-sm">
              {t("chat.botEmptyHint", { name: bot.name })}
            </span>
          </div>
          {starters.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {starters.map((starter, i) => (
                <Button
                  key={`${i}-${starter}`}
                  variant="outline"
                  size="sm"
                  className="h-auto py-1.5 text-left whitespace-normal"
                  onClick={() => void send(starter, [], [])}
                >
                  {starter}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasActions = actions.length > 0;
  const hasBots = bots.length > 0;

  // Nothing to suggest — fall back to the plain empty-state line.
  if (!hasActions && !hasBots) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t("chat.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <motion.div
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="text-primary mb-1 size-8" aria-hidden />
          </motion.div>
          <h2 className="text-foreground text-lg font-semibold">
            {t("chat.suggestionsTitle")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("chat.suggestionsHint")}
          </p>
        </div>

        {hasActions && (
          <div className="flex w-full flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t("chat.quickActionsLabel")}
            </span>
            <div className="flex flex-wrap justify-center gap-2">
              {actions.map((action) => (
                <Button
                  key={action.id}
                  variant="outline"
                  size="sm"
                  className="h-auto py-1.5 text-left whitespace-normal"
                  onClick={() => runAction(action)}
                >
                  {action.label || action.prompt}
                </Button>
              ))}
            </div>
          </div>
        )}

        {hasBots && (
          <div className="flex w-full flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t("chat.chatWithLabel")}
            </span>
            <div className="flex flex-wrap justify-center gap-2">
              {bots.map((bot) => (
                <Button
                  key={bot.id}
                  variant="secondary"
                  size="sm"
                  className="h-auto gap-2 py-1.5"
                  onClick={() => startNewChatWithBot(bot)}
                  title={t("chat.chatWith", { name: bot.name })}
                >
                  <BotAvatar bot={bot} className="size-5 text-xs" />
                  {bot.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
