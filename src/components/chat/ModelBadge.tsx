import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import type { Provider } from "@/types/db";

interface ModelBadgeProps {
  provider: Provider;
  model: string;
  /** Optional role label prepended before the model name. */
  role?: string;
}

/** A small inline pill showing the model that generated a message. */
export function ModelBadge({ provider, model, role }: ModelBadgeProps) {
  const models = useModels((s) => s.models);
  const providers = useProviders();
  const m = models.find((x) => x.provider === provider && x.model_id === model);
  const p = providers.find((x) => x.id === provider);
  const label = m?.label ?? model;
  const providerLabel = p?.label ?? provider;

  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      {role && <span className="font-medium">{role}</span>}
      <span className="bg-accent text-accent-foreground rounded px-1.5 py-0.5">
        {providerLabel} · {label}
      </span>
    </span>
  );
}
