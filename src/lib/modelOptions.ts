// Pure builder for the combined chat model dropdown. Flattens the configurable
// model list into "Provider - Label" options, filtered to the providers that
// are active (passed in via `keyedProviderIds`). Kept pure and unit-tested; the
// React layer supplies the inputs.

import { isKeylessProvider, type ProviderMeta } from "@/lib/providers";
import type { Model, Provider } from "@/types/db";

export interface ModelOption {
  provider: Provider;
  providerLabel: string;
  /** Model id sent to the provider API. */
  modelId: string;
  /** Friendly model label. */
  label: string;
  /** `${providerLabel} - ${label}` for the dropdown. */
  display: string;
  /** false for a cloud model blocked while offline, or an injected current-combo
   *  entry not in the configured list. */
  active: boolean;
  /** Why the option is inactive, so the picker can show the right hint.
   *  "offline" = a cloud provider blocked because we're offline. */
  reason?: "offline";
  /** Free-text description of what this model is good at (from models.notes). */
  notes?: string;
}

/**
 * Build the dropdown options. A provider contributes its models only if it is
 * in `providers` (enabled) AND its id is in `keyedProviderIds`. If `current`
 * (the thread's saved provider+model) isn't among the results, it is prepended
 * as an inert entry so the value still renders.
 */
export function buildModelOptions(
  providers: ProviderMeta[],
  keyedProviderIds: Set<Provider>,
  models: Model[],
  current: { provider: Provider; model: string } | null,
  offline = false,
): ModelOption[] {
  const options: ModelOption[] = [];
  for (const p of providers) {
    if (!keyedProviderIds.has(p.id)) continue;
    // Offline: cloud providers are blocked; the keyless local provider (Ollama)
    // stays available so the user can keep chatting.
    const cloudBlocked = offline && !isKeylessProvider(p.id);
    const provModels = models
      .filter((m) => m.provider === p.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
    for (const m of provModels) {
      options.push({
        provider: p.id,
        providerLabel: p.label,
        modelId: m.model_id,
        label: m.label,
        display: `${p.label} - ${m.label}`,
        active: !cloudBlocked,
        reason: cloudBlocked ? "offline" : undefined,
        notes: m.notes || undefined,
      });
    }
  }
  if (current) {
    const present = options.some(
      (o) => o.provider === current.provider && o.modelId === current.model,
    );
    if (!present) {
      const meta = providers.find((p) => p.id === current.provider);
      const providerLabel = meta ? meta.label : current.provider;
      options.unshift({
        provider: current.provider,
        providerLabel,
        modelId: current.model,
        label: current.model,
        display: `${providerLabel} - ${current.model}`,
        active: false,
      });
    }
  }
  return options;
}

/** The display strings for the currently-selected provider+model. Pure; resolves
 *  synchronously from the models list + provider registry (no key lookup), so the
 *  picker trigger can render immediately without a mount flash. Falls back to the
 *  raw ids when the model/provider isn't found (e.g. a since-disabled provider). */
export function currentModelLabel(
  providers: ProviderMeta[],
  models: Model[],
  provider: Provider,
  model: string,
): { label: string; providerLabel: string } {
  const m = models.find((x) => x.provider === provider && x.model_id === model);
  const p = providers.find((x) => x.id === provider);
  return {
    label: m?.label ?? model,
    providerLabel: p?.label ?? provider,
  };
}
