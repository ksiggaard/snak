import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { BotEditor } from "@/components/bots/BotEditor";
import { useBots } from "@/store/bots";
import { confirmDialog } from "@/store/confirm";
import { t as tNow, useIntlLocale, useT } from "@/store/i18n";
import { parseDbTime } from "@/lib/time";

/** T38 settings card: bot management — create, browse, delete, and (via the
 *  embedded BotEditor) edit each bot. Clicking a row toggles its editor. */
export function Bots() {
  const t = useT();
  const locale = useIntlLocale();
  const bots = useBots((s) => s.bots);
  const init = useBots((s) => s.init);
  const create = useBots((s) => s.create);
  const remove = useBots((s) => s.remove);

  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  async function onCreate() {
    const b = await create();
    setSelectedBotId(b.id);
  }

  return (
    <Card className="w-full max-w-lg overflow-visible">
      <CardHeader>
        <CardTitle>{t("bots.title")}</CardTitle>
        <CardDescription>{t("bots.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <Button onClick={() => void onCreate()}>
            <Plus className="size-4" />
            {t("bots.create")}
          </Button>
        </div>

        {bots.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("bots.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {bots.map((bot) => (
              <li key={bot.id} className="flex flex-col">
                <div className="hover:bg-accent/50 flex items-center gap-2 rounded-md px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedBotId((id) => (id === bot.id ? null : bot.id))
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                  >
                    <BotAvatar bot={bot} className="size-8 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{bot.name}</span>
                      {bot.tagline && (
                        <span className="text-muted-foreground truncate text-xs">
                          {bot.tagline}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {parseDbTime(bot.created_at).toLocaleDateString(locale)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("sidebar.deleteBot")}
                    onClick={() => {
                      void confirmDialog({
                        title: tNow("sidebar.deleteBotTitle", {
                          name: bot.name,
                        }),
                        description: tNow("sidebar.deleteBotDescription"),
                        confirmText: tNow("common.delete"),
                        destructive: true,
                      }).then((ok) => {
                        if (!ok) return;
                        setSelectedBotId((id) => (id === bot.id ? null : id));
                        void remove(bot.id);
                      });
                    }}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {selectedBotId === bot.id && (
                  <div className="mt-2 mb-3 ml-3 border-l pl-3">
                    <BotEditor bot={bot} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
