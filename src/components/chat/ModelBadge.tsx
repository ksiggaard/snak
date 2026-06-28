import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { useT } from "@/store/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OUTPUT_TYPES, DEFAULT_OUTPUT_TYPE } from "@/lib/outputTypes";
import type { MessageToolCall } from "@/lib/messages";
import type { Plan } from "@/lib/planner";
import type { Provider } from "@/types/db";
import type { MessageKey } from "@/store/i18n";

interface ModelBadgeProps {
  provider: Provider;
  model: string;
  /** Optional role label prepended before the model name. */
  role?: string;
  /** Output type (response-style) active when this reply was generated.
   * null/undefined or 'default' → shown as the default style. */
  outputType?: string | null;
  /** Tools the model invoked while producing this reply (hover detail). */
  toolCalls?: MessageToolCall[];
  /** Planner plan that orchestrated this reply, when in planner mode. */
  plan?: Plan;
}

/** i18n label key per output type id, for the hover detail. */
const OUTPUT_TYPE_LABEL = new Map<string, MessageKey>(
  OUTPUT_TYPES.map((o) => [o.id, o.labelKey]),
);

/** One labelled row in the hover detail panel. */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-background/60 w-20 shrink-0">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

/** A small inline pill showing the model that generated a message. Hovering it
 *  reveals a detail panel: the exact model, the output style, which tools ran,
 *  and — for planner-orchestrated replies — the strategy, models, and step
 *  count (iterations). */
export function ModelBadge({
  provider,
  model,
  role,
  outputType,
  toolCalls,
  plan,
}: ModelBadgeProps) {
  const t = useT();
  const models = useModels((s) => s.models);
  const providers = useProviders();
  const m = models.find((x) => x.provider === provider && x.model_id === model);
  const p = providers.find((x) => x.id === provider);
  const label = m?.label ?? model;
  const providerLabel = p?.label ?? provider;

  // Resolve a friendly label for a (provider, model) pair, for the planner's
  // per-step model list (steps may use models other than this reply's own).
  const modelLabel = (prov: Provider, id: string) => {
    const meta = models.find((x) => x.provider === prov && x.model_id === id);
    const provMeta = providers.find((x) => x.id === prov);
    return `${provMeta?.label ?? prov} · ${meta?.label ?? id}`;
  };

  // Output style label — falls back to the default entry for null/unknown ids.
  const outputKey =
    OUTPUT_TYPE_LABEL.get(outputType || DEFAULT_OUTPUT_TYPE) ??
    OUTPUT_TYPE_LABEL.get(DEFAULT_OUTPUT_TYPE)!;

  // Distinct tool names invoked (order preserved), for the "Tools used" row.
  const toolNames = [...new Set((toolCalls ?? []).map((c) => c.name))];

  // Planner: distinct models used across steps, and the step count (iterations).
  const planModels = plan
    ? [...new Set(plan.steps.map((s) => modelLabel(s.provider, s.model)))]
    : [];
  const strategyKey: MessageKey | null = plan
    ? plan.strategy === "multi_step"
      ? "chat.modelInfo.strategyMultiStep"
      : plan.strategy === "route"
        ? "chat.modelInfo.strategyRoute"
        : "chat.modelInfo.strategyDirect"
    : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="text-muted-foreground inline-flex cursor-default items-center gap-1 rounded text-xs focus-visible:outline-none"
        >
          {role && <span className="font-medium">{role}</span>}
          <span className="bg-accent text-accent-foreground rounded px-1.5 py-0.5">
            {providerLabel} · {label}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs items-stretch" sideOffset={4}>
        <div className="w-full space-y-1.5 text-left text-xs">
          <DetailRow label={t("chat.modelInfo.model")}>
            {providerLabel} · {label}
          </DetailRow>
          <DetailRow label={t("chat.modelInfo.outputStyle")}>
            {t(outputKey)}
          </DetailRow>
          <DetailRow label={t("chat.modelInfo.tools")}>
            {toolNames.length > 0 ? (
              <span className="font-mono">{toolNames.join(", ")}</span>
            ) : (
              <span className="text-background/60">
                {t("chat.modelInfo.noTools")}
              </span>
            )}
          </DetailRow>
          {plan && strategyKey && (
            <div className="border-background/20 space-y-1.5 border-t pt-1.5">
              <div className="text-background/60 font-semibold tracking-wide uppercase">
                {t("chat.modelInfo.planner")}
              </div>
              <DetailRow label={t("chat.modelInfo.strategy")}>
                {t(strategyKey)}
              </DetailRow>
              <DetailRow label={t("chat.modelInfo.steps")}>
                {plan.steps.length}
              </DetailRow>
              {planModels.length > 0 && (
                <DetailRow label={t("chat.modelInfo.plannerModels")}>
                  {planModels.join(", ")}
                </DetailRow>
              )}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
