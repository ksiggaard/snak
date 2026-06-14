import { useMemo } from "react";
import { estimateContextTokens } from "@/lib/contextSize";
import type { CompactableMessage } from "@/lib/compaction";
import { formatTokens } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { useContextWindows } from "@/store/contextWindows";
import { useT } from "@/store/i18n";

interface ContextMeterProps {
  /** The model in effect for this thread/draft — keys the optional max window. */
  model: string;
  messages: CompactableMessage[];
  draftText: string;
  draftImageCount: number;
  draftDocuments: { name: string; text: string }[];
}

/**
 * T53 (IDEA 24): a small readout at the bottom of the chat showing roughly how
 * much context the next message will use. Always shows a labelled estimate; when
 * the active model has a configured max window (Settings → Context windows) it
 * also shows `used / max (%)` with a fill bar that warns as it approaches the
 * limit. The count is an estimate — the exact usage is captured after sending.
 */
export function ContextMeter({
  model,
  messages,
  draftText,
  draftImageCount,
  draftDocuments,
}: ContextMeterProps) {
  const t = useT();
  const max = useContextWindows((s) => s.windows[model]);

  const tokens = useMemo(
    () =>
      estimateContextTokens({
        messages,
        draftText,
        draftImageCount,
        draftDocuments,
      }),
    [messages, draftText, draftImageCount, draftDocuments],
  );

  if (!max) {
    return (
      <p
        className="text-muted-foreground px-1 text-[11px]"
        title={t("composer.contextEstimateHint")}
      >
        {t("composer.contextEstimate", { tokens: formatTokens(tokens) })}
      </p>
    );
  }

  const pct = Math.round((tokens / max) * 100);
  const over = pct >= 100;
  const near = pct >= 90;
  return (
    <div
      className="text-muted-foreground flex items-center gap-2 px-1 text-[11px]"
      title={t("composer.contextEstimateHint")}
    >
      <span className={cn(over && "text-destructive font-medium")}>
        {t("composer.context", {
          used: formatTokens(tokens),
          max: formatTokens(max),
          pct: String(pct),
        })}
      </span>
      <div className="bg-muted h-1 max-w-40 flex-1 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full",
            over
              ? "bg-destructive"
              : near
                ? "bg-amber-500"
                : "bg-primary/60",
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
