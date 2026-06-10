import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import type { Provider } from "@/types/db";

/**
 * Models settings card: per enabled provider, list its configured models and
 * allow add/remove. The combined chat dropdown and the Default Model picker
 * read this list (via `useModels`).
 */
export function Models() {
  const providers = useProviders();
  const models = useModels((s) => s.models);
  const add = useModels((s) => s.add);
  const remove = useModels((s) => s.remove);

  // Per-provider draft inputs for the add row, keyed by provider id.
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});
  const [idDraft, setIdDraft] = useState<Record<string, string>>({});

  function submit(provider: Provider) {
    const label = (labelDraft[provider] ?? "").trim();
    const modelId = (idDraft[provider] ?? "").trim();
    if (!label || !modelId) return;
    void add(provider, modelId, label);
    setLabelDraft((d) => ({ ...d, [provider]: "" }));
    setIdDraft((d) => ({ ...d, [provider]: "" }));
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Models</CardTitle>
        <CardDescription>
          The models offered per provider in the chat picker. Each has a model
          id (sent to the API) and a friendly label.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {providers.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No providers enabled — enable one in Settings → Plugins.
          </p>
        )}
        {providers.map((p) => {
          const rows = models.filter((m) => m.provider === p.id);
          return (
            <div key={p.id} className="flex flex-col gap-2">
              <div className="text-sm font-medium">{p.label}</div>
              {rows.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  No models yet — add one below.
                </p>
              )}
              {rows.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{m.label}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {m.model_id}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void remove(m.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={labelDraft[p.id] ?? ""}
                  onChange={(e) =>
                    setLabelDraft((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  placeholder="Label (e.g. Opus 4.8)"
                  className="h-8 text-sm"
                />
                <Input
                  value={idDraft[p.id] ?? ""}
                  onChange={(e) =>
                    setIdDraft((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  placeholder="model id"
                  className="h-8 font-mono text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit(p.id);
                    }
                  }}
                />
                <Button size="sm" onClick={() => submit(p.id)}>
                  Add
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
