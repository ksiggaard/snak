import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { useT } from "@/store/i18n";
import { cn } from "@/lib/utils";
import type { Plan } from "@/lib/planner";
import type { Provider } from "@/types/db";

interface PlanPanelProps {
  plan: Plan;
}

/** Collapsible panel showing the planner's reasoning and step list. */
export function PlanPanel({ plan }: PlanPanelProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const models = useModels((s) => s.models);
  const providers = useProviders();

  const modelLabel = (p: Provider, m: string) => {
    const found = models.find(
      (x) => x.provider === p && x.model_id === m,
    );
    return found?.label ?? m;
  };
  const providerLabel = (p: Provider) => {
    const found = providers.find((x) => x.id === p);
    return found?.label ?? p;
  };

  return (
    <div className="border-border/50 rounded-md border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="hover:bg-accent/50 flex w-full items-center gap-2 rounded-t-md px-3 py-2 text-left text-sm"
      >
        <Brain className="text-muted-foreground size-3.5 shrink-0" />
        <span className="flex-1 font-medium">{t("planner.planTitle")}</span>
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-2 text-sm">
          {plan.reasoning && (
            <p className="text-muted-foreground text-xs">{plan.reasoning}</p>
          )}
          <div className="space-y-1">
            {plan.steps.map((step) => (
              <div
                key={step.id}
                className="flex items-start gap-2 rounded px-2 py-1"
              >
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums pt-px">
                  {step.id}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs">{step.description}</span>
                  <span
                    className={cn(
                      "text-muted-foreground ml-2 text-xs",
                    )}
                  >
                    {providerLabel(step.provider)} · {modelLabel(step.provider, step.model)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
