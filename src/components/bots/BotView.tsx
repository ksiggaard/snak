import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { BotEditor } from "@/components/bots/BotEditor";
import { useBots } from "@/store/bots";
import { useThreads } from "@/store/threads";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useT } from "@/store/i18n";

/** Main-pane bot editor view (T38), shown when a bot is opened from the
 *  sidebar's Bots pane. Mirrors ProjectView: header (avatar + name + new-chat
 *  action) above the shared edit form. */
export function BotView() {
  const t = useT();
  const openBotId = useBots((s) => s.openBotId);
  const bots = useBots((s) => s.bots);
  const closeBot = useBots((s) => s.close);
  const startNewChatWithBot = useThreads((s) => s.startNewChatWithBot);
  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);

  const bot = bots.find((b) => b.id === openBotId);

  if (!bot) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t("bots.notFound")}
      </div>
    );
  }

  const newChat = () => {
    showChat();
    clearSearch();
    closeBot();
    startNewChatWithBot(bot);
  };

  return (
    <div className="bg-card flex flex-1 flex-col gap-5 overflow-y-auto rounded-lg border p-5">
      <div className="flex items-center gap-3">
        <BotAvatar bot={bot} className="size-8 shrink-0 text-base" />
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {bot.name}
        </h2>
        <Button variant="outline" size="sm" onClick={newChat}>
          <Plus className="size-4" />
          {t("bots.newChat", { name: bot.name })}
        </Button>
      </div>
      <BotEditor bot={bot} />
    </div>
  );
}
