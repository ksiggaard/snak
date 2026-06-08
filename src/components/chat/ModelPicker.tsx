import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useThreads } from "@/store/threads";
import { PROVIDERS } from "@/lib/providers";
import type { Provider } from "@/types/db";

export function ModelPicker() {
  const currentId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);
  const draftModel = useThreads((s) => s.draftModel);
  const setProviderModel = useThreads((s) => s.setProviderModel);

  const current = threads.find((t) => t.id === currentId);
  const provider = current?.provider ?? draftProvider;
  const model = current?.model ?? draftModel;

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
    const def = PROVIDERS.find((x) => x.id === p)!.defaultModel;
    void setProviderModel(p, def);
  }

  function commitModel() {
    const m = modelDraft.trim();
    if (m && m !== model) void setProviderModel(provider, m);
    else setModelDraft(model);
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={provider}
        onChange={(e) => onProviderChange(e.target.value as Provider)}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
      >
        {PROVIDERS.map((p) => (
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
