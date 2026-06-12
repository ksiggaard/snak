import { botAvatarUrl, botMonogram } from "@/lib/bots";
import { cn } from "@/lib/utils";
import type { Bot } from "@/types/db";

interface BotAvatarProps {
  bot: Pick<Bot, "name" | "avatar_media_type" | "avatar_data">;
  /** Size/extras from the caller, e.g. "size-5" (sidebar) or "size-16"
   *  (editor). The monogram text scales with the em size automatically. */
  className?: string;
}

/** A bot's avatar (T38): the uploaded image when set, else a monogram circle
 *  with the name's first letter — mirroring the provider-monogram pattern in
 *  `ThreadRow.tsx`. Decorative (`alt=""`/`aria-hidden`): callers render the
 *  bot's name alongside. */
export function BotAvatar({ bot, className }: BotAvatarProps) {
  const url = botAvatarUrl(bot);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "bg-primary/10 text-primary grid place-items-center rounded-full text-[0.55em] font-bold select-none",
        className,
      )}
      aria-hidden
    >
      {botMonogram(bot.name)}
    </span>
  );
}
