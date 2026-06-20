import { useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronsUpDown } from "lucide-react";
import { useModels } from "@/store/models";
import { useKeys } from "@/store/keys";
import { useIsOffline } from "@/store/connectivity";
import { useT } from "@/store/i18n";
import { useProviders, withKeylessProviders } from "@/lib/providers";
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types/db";

interface ModelChooserProps {
  provider: Provider;
  model: string;
  onSelect: (provider: Provider, model: string) => void;
  align?: "start" | "end";
  className?: string;
  /** Override the set of provider IDs considered "keyed". Pass a set of all
   *  enabled provider IDs to show all models regardless of saved API keys
   *  (used by the Default Model settings card). */
  keyed?: Set<Provider>;
  /** Planner entry shown at the top of the dropdown (separated by a divider).
   *  When active, the button display changes to "Planner" instead of the
   *  current model label. */
  plannerEntry?: {
    active: boolean;
    providerLabel: string;
    modelLabel: string;
    onSelect: () => void;
  };
}

export function ModelChooser({
  provider,
  model,
  onSelect,
  align = "end",
  className,
  keyed: keyedProp,
  plannerEntry,
}: ModelChooserProps) {
  const t = useT();
  const models = useModels((s) => s.models);
  const providers = useProviders();
  const { label, providerLabel: currentProviderLabel } = currentModelLabel(
    providers,
    models,
    provider,
    model,
  );

  // When planner is active the button shows the planner label instead of the
  // current model — the underlying provider/model are the planner model (swapped
  // by setUsePlanner), so showing "Planner" communicates the mode clearly.
  const displayLabel = plannerEntry?.active ? t("planner.title") : label;
  const tooltipLabel = plannerEntry?.active
    ? `${plannerEntry.providerLabel} · ${plannerEntry.modelLabel}`
    : `${currentProviderLabel} · ${model}`;

  const present = useKeys((s) => s.present);
  const keysLoaded = useKeys((s) => s.loaded);
  // Keyless providers (local Ollama, T37) never have a stored key — union them
  // in so their models always list.
  const keyed =
    keyedProp ?? (keysLoaded ? withKeylessProviders(present, providers) : null);

  const offline = useIsOffline();
  const options =
    keyed === null
      ? []
      : buildModelOptions(providers, keyed, models, { provider, model }, offline);

  const groups: { providerLabel: string; items: typeof options }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.providerLabel === o.providerLabel);
    if (g) g.items.push(o);
    else groups.push({ providerLabel: o.providerLabel, items: [o] });
  }

  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setOpenAbove(rect.top > window.innerHeight - rect.bottom);
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("model.choose")}
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={handleToggle}
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors",
              className,
            )}
          >
            <span className="text-foreground max-w-40 truncate">{displayLabel}</span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>

      {open && (
        <div
          role="listbox"
          aria-label={t("model.aria")}
          className={cn(
            "bg-popover text-popover-foreground absolute z-50 min-w-48 rounded-lg p-1 shadow-md ring-1 ring-foreground/10",
            openAbove ? "bottom-full mb-1" : "mt-1",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {keyed === null ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">
              {t("common.loading")}
            </div>
          ) : (
            <>
              {plannerEntry && (
                <>
                  <button
                    role="option"
                    aria-selected={plannerEntry.active}
                    type="button"
                    onClick={() => {
                      plannerEntry.onSelect();
                      setOpen(false);
                    }}
                    className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm"
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        plannerEntry.active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Brain className="size-4 shrink-0" />
                    <div className="flex-1 truncate text-left">
                      <span>{t("planner.title")}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {plannerEntry.providerLabel} · {plannerEntry.modelLabel}
                      </span>
                    </div>
                  </button>
                  {groups.length > 0 && (
                    <div className="bg-border -mx-1 my-1 h-px" />
                  )}
                </>
              )}
              {groups.map((g, gi) => (
              <div key={g.providerLabel}>
                {gi > 0 && <div className="bg-border -mx-1 my-1 h-px" />}
                <div className="text-muted-foreground px-1.5 py-1 text-xs font-medium">
                  {g.providerLabel}
                </div>
                {g.items.map((o) => {
                  const selected =
                    !plannerEntry?.active &&
                    o.provider === provider &&
                    o.modelId === model;
                  return (
                    <button
                      key={`${o.provider}:${o.modelId}`}
                      role="option"
                      aria-selected={selected}
                      type="button"
                      disabled={!o.active}
                      onClick={() => {
                        onSelect(o.provider, o.modelId);
                        setOpen(false);
                      }}
                      className={cn(
                        "hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm disabled:pointer-events-none disabled:opacity-50",
                      )}
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex-1 truncate text-left">
                        <span>{o.label}</span>
                        {o.notes && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {o.notes}
                          </span>
                        )}
                      </div>
                      {!o.active && (
                        <span className="text-muted-foreground text-xs">
                          {t(
                            o.reason === "offline"
                              ? "model.offline"
                              : "model.unavailable",
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              ))}
              </>
          )}
        </div>
      )}
    </div>
  );
}
