import { useEffect, useState } from "react";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { buildModelOptions } from "@/lib/modelOptions";
import { hasApiKey } from "@/lib/keys";
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

  // Which enabled providers have a stored API key. Resolved async (like
  // ApiKeys.tsx); recomputed when the provider list changes. Leaving Settings
  // remounts ChatView, so a newly-added key is reflected on return to chat.
  const [keyed, setKeyed] = useState<Set<Provider>>(new Set());
  const providerKey = providers.map((p) => p.id).join(",");
  useEffect(() => {
    let active = true;
    void Promise.all(
      providers.map((p) => hasApiKey(p.id).then((ok) => [p.id, ok] as const)),
    ).then((pairs) => {
      if (active) setKeyed(new Set(pairs.filter(([, ok]) => ok).map(([id]) => id)));
    });
    return () => {
      active = false;
    };
    // providerKey captures the provider-list identity (primitive, stable).
  }, [providerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = buildModelOptions(providers, keyed, models, { provider, model });
  const selectedIndex = options.findIndex(
    (o) => o.provider === provider && o.modelId === model,
  );

  if (options.length === 0) {
    return (
      <span className="text-muted-foreground text-sm">
        No models available — add an API key and models in Settings.
      </span>
    );
  }

  return (
    <select
      value={selectedIndex >= 0 ? selectedIndex : 0}
      onChange={(e) => {
        const opt = options[Number(e.target.value)];
        if (opt) void setProviderModel(opt.provider, opt.modelId);
      }}
      className="border-input bg-background h-9 max-w-72 rounded-md border px-2 text-sm"
      aria-label="Model"
    >
      {options.map((o, i) => (
        <option key={`${o.provider}:${o.modelId}`} value={i}>
          {o.display}
          {o.active ? "" : " (unavailable)"}
        </option>
      ))}
    </select>
  );
}
