import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useThreads } from "@/store/threads";
import { useProviders } from "@/lib/providers";
import type { Provider } from "@/types/db";

/**
 * Default-model settings: the provider+model new chats and the quick-input
 * overlay start from. Mirrors ModelPicker's UX (provider dropdown + free-text
 * model; switching provider prefills its defaultModel) but writes the persisted
 * default via `setDefaultModel` instead of the current thread/draft.
 */
export function DefaultModel() {
  const provider = useThreads((s) => s.defaultProvider);
  const model = useThreads((s) => s.defaultModel);
  const setDefaultModel = useThreads((s) => s.setDefaultModel);
  const providers = useProviders();

  const providerEnabled = providers.some((p) => p.id === provider);
  const allDisabled = providers.length === 0;

  // Local model draft so typing doesn't persist on every keystroke; re-sync at
  // render (not via effect) when the stored model changes.
  const [modelDraft, setModelDraft] = useState(model);
  const [syncedModel, setSyncedModel] = useState(model);
  if (model !== syncedModel) {
    setSyncedModel(model);
    setModelDraft(model);
  }

  function onProviderChange(p: Provider) {
    const meta = providers.find((x) => x.id === p);
    if (!meta) return; // ignore the inert disabled-provider option
    void setDefaultModel(p, meta.defaultModel);
  }

  function commitModel() {
    const m = modelDraft.trim();
    if (m && m !== model) void setDefaultModel(provider, m);
    else setModelDraft(model);
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Default Model</CardTitle>
        <CardDescription>
          The provider and model new chats (and the quick-input overlay) start
          with. You can still change the model per chat from the top bar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {allDisabled ? (
          <p className="text-muted-foreground text-sm">
            No providers enabled — enable one in Settings → Plugins.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as Provider)}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
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
              aria-label="Default model"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
