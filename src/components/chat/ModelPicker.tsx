import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useThreads } from "@/store/threads";
import { useProviders } from "@/lib/providers";
import type { Provider } from "@/types/db";

export function ModelPicker() {
  const currentId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);
  const draftModel = useThreads((s) => s.draftModel);
  const setProviderModel = useThreads((s) => s.setProviderModel);

  // Active providers come from the enabled provider plugins (T18). Empty = all
  // providers disabled.
  const providers = useProviders();

  const current = threads.find((t) => t.id === currentId);
  const provider = current?.provider ?? draftProvider;
  const model = current?.model ?? draftModel;

  // The thread's provider may reference one that's since been disabled. Keep it
  // visible as an inert option so the value still renders (no crash) and the
  // user can re-enable it; otherwise the <select> would silently show option[0].
  const providerEnabled = providers.some((p) => p.id === provider);
  const allDisabled = providers.length === 0;

  // Local model draft so typing doesn't write to the DB on every keystroke.
  // Re-sync during render (not via an effect) when the active model changes,
  // e.g. after switching threads or providers.
  const [modelDraft, setModelDraft] = useState(model);
  const [syncedModel, setSyncedModel] = useState(model);
  if (model !== syncedModel) {
    setSyncedModel(model);
    setModelDraft(model);
  }

  function onProviderChange(p: Provider) {
    const meta = providers.find((x) => x.id === p);
    if (!meta) return; // ignore the inert disabled-provider option
    void setProviderModel(p, meta.defaultModel);
  }

  function commitModel() {
    const m = modelDraft.trim();
    if (m && m !== model) void setProviderModel(provider, m);
    else setModelDraft(model);
  }

  if (allDisabled) {
    return (
      <span className="text-muted-foreground text-sm">
        No providers enabled — enable one in Settings → Plugins.
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={provider}
        onChange={(e) => onProviderChange(e.target.value as Provider)}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
      >
        {/* Stored provider that's now disabled: show it (disabled) so the value
            renders and the user sees what the thread is set to. */}
        {!providerEnabled && (
          <option value={provider} disabled>
            {provider} (disabled)
          </option>
        )}
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <Input
        value={modelDraft}
        onChange={(e) => setModelDraft(e.target.value)}
        onBlur={commitModel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitModel();
          }
        }}
        className="h-9 w-56 text-sm"
        aria-label="Model"
      />
    </div>
  );
}
