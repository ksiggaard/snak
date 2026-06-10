import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
import { hasApiKey } from "@/lib/keys";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types/db";

export function ModelPicker() {
  const currentId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);
  const draftModel = useThreads((s) => s.draftModel);
  const setProviderModel = useThreads((s) => s.setProviderModel);
  const models = useModels((s) => s.models);

  // Active providers come from the enabled provider plugins (T18).
  const providers = useProviders();

  const current = threads.find((t) => t.id === currentId);
  const provider = current?.provider ?? draftProvider;
  const model = current?.model ?? draftModel;

  // Trigger label resolves synchronously (no `keyed` dependency) so the picker
  // renders immediately with no mount flash.
  const { label, providerLabel } = currentModelLabel(providers, models, provider, model);

  // Which enabled providers have a stored API key. Resolved async (like
  // ApiKeys.tsx); recomputed when the provider list changes.
  const [keyed, setKeyed] = useState<Set<Provider> | null>(null);
  const providerKey = providers.map((p) => p.id).join(",");
  useEffect(() => {
    let active = true;
    void Promise.all(
      providers.map((p) => hasApiKey(p.id).then((ok) => [p.id, ok] as const)),
    )
      .then((pairs) => {
        if (active) setKeyed(new Set(pairs.filter(([, ok]) => ok).map(([id]) => id)));
      })
      .catch(() => {
        if (active) setKeyed(new Set());
      });
    return () => {
      active = false;
    };
    // providerKey captures the provider-list identity (primitive, stable).
  }, [providerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const options =
    keyed === null ? [] : buildModelOptions(providers, keyed, models, { provider, model });

  // Group options by provider for the chooser, preserving option order.
  const groups: { providerLabel: string; items: typeof options }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.providerLabel === o.providerLabel);
    if (g) g.items.push(o);
    else groups.push({ providerLabel: o.providerLabel, items: [o] });
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Choose model"
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors"
            >
              <span className="text-foreground max-w-40 truncate">{label}</span>
              <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {providerLabel} · {model}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {keyed === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : (
          groups.map((g, gi) => (
            <div key={g.providerLabel}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                {g.providerLabel}
              </DropdownMenuLabel>
              {g.items.map((o) => {
                const selected = o.provider === provider && o.modelId === model;
                return (
                  <DropdownMenuItem
                    key={`${o.provider}:${o.modelId}`}
                    disabled={!o.active}
                    onSelect={() => void setProviderModel(o.provider, o.modelId)}
                  >
                    <Check
                      className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
                    />
                    <span className="flex-1 truncate">{o.label}</span>
                    {!o.active && (
                      <span className="text-muted-foreground text-xs">unavailable</span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
