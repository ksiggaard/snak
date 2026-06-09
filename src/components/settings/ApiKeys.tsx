import { useEffect, useState } from "react";
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
import { deleteApiKey, hasApiKey, setApiKey } from "@/lib/keys";
import type { Provider } from "@/types/db";

type Statuses = Partial<Record<Provider, boolean>>;
type Drafts = Partial<Record<Provider, string>>;

export function ApiKeys() {
  // Only enabled provider plugins get a key row (T18) — disabling a provider
  // removes it from the settings list.
  const providers = useProviders();
  const [statuses, setStatuses] = useState<Statuses>({});
  const [drafts, setDrafts] = useState<Drafts>({});
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(provider: Provider) {
    const present = await hasApiKey(provider);
    setStatuses((s) => ({ ...s, [provider]: present }));
  }

  // Load presence for every enabled provider. Re-runs if the enabled set changes
  // (a newly-enabled provider gets its status checked). Keyed on the id list to
  // keep the dependency primitive and stable.
  const providerKey = providers.map((p) => p.id).join(",");
  useEffect(() => {
    Promise.all(providers.map((p) => refresh(p.id))).catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    // providers is recomputed each render; providerKey captures its identity.
  }, [providerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(provider: Provider) {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    setBusy(provider);
    setError(null);
    try {
      await setApiKey(provider, key);
      // Drop the plaintext from component state immediately after storing.
      setDrafts((d) => ({ ...d, [provider]: "" }));
      await refresh(provider);
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
      await refresh(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Keys are stored in your OS keychain and never leave this machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {providers.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No providers are enabled. Enable a provider plugin in the Plugins
            section below to add its API key.
          </p>
        )}
        {providers.map((p) => {
          const saved = statuses[p.id];
          const draft = drafts[p.id] ?? "";
          const isBusy = busy === p.id;
          return (
            <div key={p.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`key-${p.id}`}>{p.label}</Label>
                <span className="text-xs">
                  {saved === undefined ? (
                    <span className="text-muted-foreground">checking…</span>
                  ) : saved ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Saved ✓
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  id={`key-${p.id}`}
                  type="password"
                  autoComplete="off"
                  placeholder={saved ? "•••••••• (stored)" : p.keyHint}
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
                  {saved ? "Update" : "Save"}
                </Button>
                {saved && (
                  <Button
                    variant="outline"
                    onClick={() => void remove(p.id)}
                    disabled={isBusy}
                  >
                    Remove
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
