import { useEffect, useState } from "react";
import { Check, Circle, Loader2, X } from "lucide-react";
import { useThreads, getLastActivity } from "@/store/threads";
import { useAppearance } from "@/store/appearance";
import { useT } from "@/store/i18n";
import { formatClock } from "@/lib/time";
import { evaluateStale } from "@/lib/staleness";
import { cn } from "@/lib/utils";

// Unified run indicator: one pill for both normal chat and planner. Shows
// "{n}. {step} | M:SS" with a shimmer on the active step; hover expands to the
// full step bar. Re-renders at most once a second (the clock) — the live token
// stream never touches it — and `tabular-nums` keeps the clock width fixed so
// nothing jitters. Past the grace period it surfaces the stale-check countdown;
// the watchdog (store-side) does the actual stopping.

const STEP_ICON = {
  done: <Check className="size-3 text-emerald-500" />,
  active: <Loader2 className="size-3 animate-spin" />,
  pending: <Circle className="size-3 opacity-30" />,
  error: <X className="text-destructive size-3" />,
} as const;

export function ProgressIndicator() {
  const t = useT();
  const cid = useThreads((s) => s.currentThreadId);
  const progress = useThreads((s) => (cid ? s.threadProgress[cid] : undefined));
  const animations = useAppearance((s) => s.animations);

  // One 1 Hz tick drives the clock + stale countdown, started only while a run
  // is active. setState fires from the timer (not the effect body), satisfying
  // react-hooks/set-state-in-effect.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!progress) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [progress]);

  if (!progress || !cid) return null;

  const step = progress.steps[progress.current];
  const stale = progress.status === "stale";
  const act = getLastActivity(cid) ?? progress.startedAt;
  const watch = evaluateStale(now, progress.stepStartedAt, act);
  const note = stale
    ? t("progress.stale.label")
    : watch.watching && watch.nextCheckSec != null
      ? t("progress.stale.checking", { n: String(watch.nextCheckSec) })
      : null;

  return (
    <div className="group relative w-fit px-1">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
          stale
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "bg-muted/60 border-transparent",
        )}
      >
        <span className="text-muted-foreground/60 tabular-nums">
          {progress.current + 1}.
        </span>
        <span
          className={cn(
            "text-foreground font-medium",
            !stale && animations && "snak-shimmer",
          )}
        >
          {step?.label}
        </span>
        <span className="text-muted-foreground/40" aria-hidden>
          |
        </span>
        <span className="text-muted-foreground tabular-nums">
          {formatClock(now - progress.startedAt)}
        </span>
        {note && (
          <span
            className={cn("ml-0.5", !stale && "text-muted-foreground/70")}
          >
            · {note}
          </span>
        )}
      </div>

      {/* Hover: the full step bar — the "more informative" state. Absolutely
          positioned so it pops over the messages instead of shifting layout. */}
      <div className="absolute bottom-full left-1 z-10 mb-1 hidden min-w-56 group-hover:block">
        <div className="bg-popover text-popover-foreground flex flex-col gap-1 rounded-md border p-2 text-xs shadow-md">
          {progress.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="shrink-0">
                {STEP_ICON[s.status]}
              </span>
              <span
                className={cn(
                  "flex-1 truncate",
                  s.status === "pending" && "text-muted-foreground",
                  s.status === "active" && "text-foreground font-medium",
                )}
              >
                {s.label}
              </span>
              {s.detail && (
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {s.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
