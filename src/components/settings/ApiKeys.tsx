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
import { Label } from "@/components/ui/label";
import { useProviders } from "@/lib/providers";
import { deleteApiKey, setApiKey } from "@/lib/keys";
import { useKeys } from "@/store/keys";
import { useT } from "@/store/i18n";
import type { Provider } from "@/types/db";

type Drafts = Partial<Record<Provider, string>>;

export function ApiKeys() {
  const t = useT();
  // Only enabled provider plugins get a key row (T18) — disabling a provider
  // removes it from the settings list.
  const providers = useProviders();
  // Presence comes from the cached keys store (no keychain reads on open). The
  // store is loaded app-wide in App; save/remove keep its cache in sync.
  const present = useKeys((s) => s.present);
  const keysLoaded = useKeys((s) => s.loaded);
  const setPresent = useKeys((s) => s.setPresent);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(provider: Provider) {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    setBusy(provider);
    setError(null);
    try {
      await setApiKey(provider, key);
      // Drop the plaintext from component state immediately after storing.
      setDrafts((d) => ({ ...d, [provider]: "" }));
      await setPresent(provider, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: Provider) {
    setBusy(provider);
    setError(null);
    try {
      await deleteApiKey(provider);
      await setPresent(provider, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("apiKeys.title")}</CardTitle>
        <CardDescription>{t("apiKeys.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {providers.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {t("apiKeys.noProviders")}
          </p>
        )}
        {providers.map((p) => {
          const saved = keysLoaded ? present.has(p.id) : undefined;
          const draft = drafts[p.id] ?? "";
          const isBusy = busy === p.id;
          return (
            <div key={p.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`key-${p.id}`}>{p.label}</Label>
                <span className="text-xs">
                  {saved === undefined ? (
                    <span className="text-muted-foreground">
                      {t("apiKeys.checking")}
                    </span>
                  ) : saved ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {t("apiKeys.saved")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("apiKeys.notSet")}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  id={`key-${p.id}`}
                  type="password"
                  autoComplete="off"
                  placeholder={
                    saved ? t("apiKeys.storedPlaceholder") : p.keyHint
                  }
                  value={draft}
                  disabled={isBusy}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void save(p.id);
                  }}
                />
                <Button
                  onClick={() => void save(p.id)}
                  disabled={isBusy || draft.trim().length === 0}
                >
                  {saved ? t("common.update") : t("common.save")}
                </Button>
                {saved && (
                  <Button
                    variant="outline"
                    onClick={() => void remove(p.id)}
                    disabled={isBusy}
                  >
                    {t("common.remove")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
