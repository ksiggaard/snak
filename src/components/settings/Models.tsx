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
import { useT } from "@/store/i18n";
import { useProviders } from "@/lib/providers";
import type { Provider } from "@/types/db";

/**
 * Models settings card: per enabled provider, list its configured models and
 * allow add/remove. The combined chat dropdown and the Default Model picker
 * read this list (via `useModels`).
 */
export function Models() {
  const t = useT();
  const providers = useProviders();
  const models = useModels((s) => s.models);
  const add = useModels((s) => s.add);
  const remove = useModels((s) => s.remove);
  const error = useModels((s) => s.error);

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
        <CardTitle>{t("models.title")}</CardTitle>
        <CardDescription>{t("models.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error && <p className="text-destructive text-sm">{error}</p>}
        {providers.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {t("models.noProviders")}
          </p>
        )}
        {providers.map((p) => {
          const rows = models.filter((m) => m.provider === p.id);
          return (
            <div key={p.id} className="flex flex-col gap-2">
              <div className="text-sm font-medium">{p.label}</div>
              {rows.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  {t("models.noModels")}
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
                    {t("common.remove")}
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={labelDraft[p.id] ?? ""}
                  onChange={(e) =>
                    setLabelDraft((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  placeholder={t("models.labelPlaceholder")}
                  className="h-8 text-sm"
                />
                <Input
                  value={idDraft[p.id] ?? ""}
                  onChange={(e) =>
                    setIdDraft((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  placeholder={t("models.idPlaceholder")}
                  className="h-8 font-mono text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit(p.id);
                    }
                  }}
                />
                <Button size="sm" onClick={() => submit(p.id)}>
                  {t("common.add")}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
