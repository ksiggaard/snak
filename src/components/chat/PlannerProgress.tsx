import { Brain, Check, Circle, Loader2, X } from "lucide-react";
import { useThreads, type StepProgress } from "@/store/threads";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { useT } from "@/store/i18n";
import { currentModelLabel } from "@/lib/modelOptions";
import { cn } from "@/lib/utils";

function StepPill({ step }: { step: StepProgress }) {
  const t = useT();
  const models = useModels((s) => s.models);
  const providers = useProviders();
  const { label } = currentModelLabel(providers, models, step.provider, step.model);

  const statusIcon = {
    pending: <Circle className="size-3 opacity-40" />,
    running: <Loader2 className="size-3 animate-spin" />,
    done: <Check className="size-3 text-emerald-500" />,
    error: <X className="text-destructive size-3" />,
  }[step.status];

  const statusLabel = {
    pending: t("planner.pill.stepPending"),
    running: t("planner.pill.stepRunning"),
    done: t("planner.pill.stepDone"),
    error: t("planner.pill.stepError"),
  }[step.status];

  return (
    <div
      className={cn(
        "bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-all duration-300",
        step.status === "running" && "bg-accent text-accent-foreground",
        step.status === "error" && "bg-destructive/15 text-destructive",
        step.status === "done" && "opacity-0",
      )}
      title={`${step.description} · ${label} — ${statusLabel}`}
    >
      {statusIcon}
      <span className="max-w-40 truncate">{step.description}</span>
    </div>
  );
}

export function PlannerProgress() {
  const t = useT();
  const cid = useThreads((s) => s.currentThreadId);
  const progress = useThreads((s) => (cid ? s.threadPlannerProgress[cid] : undefined));
  if (!progress) return null;

  const phaseLabel = (() => {
    const n = progress.steps.length;
    switch (progress.phase) {
      case "planning":
        return t("planner.pill.planning");
      case "critiquing":
        return t("planner.pill.critiquing");
      case "revising":
        return t("planner.pill.revising", {
          round: String(progress.round ?? 1),
          max: String(progress.maxRounds ?? 5),
        });
      case "dispatching":
        return t("planner.pill.dispatching", { n: String(n) });
      case "executing":
        return t("planner.pill.executing", { n: String(n) });
      case "completing":
        if (progress.directModel) {
          return t("planner.pill.direct", { model: progress.directModel });
        }
        if (progress.steps.length === 0) {
          return t("planner.pill.directSelf");
        }
        return t("planner.pill.completing");
    }
  })();

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      <div
        className={cn(
          "bg-accent text-accent-foreground flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          progress.phase === "planning" && "animate-pulse",
        )}
      >
        <Brain className="size-3" />
        <span>{phaseLabel}</span>
      </div>

      {progress.steps
        .filter((s) => s.status !== "done")
        .map((step) => (
          <StepPill key={step.id} step={step} />
        ))}
    </div>
  );
}
