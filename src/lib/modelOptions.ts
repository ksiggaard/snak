// Pure builder for the combined chat model dropdown. Flattens the configurable
// model list into "Provider - Label" options, filtered to the providers that
// are active (passed in via `keyedProviderIds`). Kept pure and unit-tested; the
// React layer supplies the inputs.

import type { ProviderMeta } from "@/lib/providers";
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
  /** false only for an injected current-combo entry not in the configured list. */
  active: boolean;
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
): ModelOption[] {
  const options: ModelOption[] = [];
  for (const p of providers) {
    if (!keyedProviderIds.has(p.id)) continue;
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
        active: true,
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
