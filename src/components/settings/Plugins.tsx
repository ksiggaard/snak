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
import { usePlugins } from "@/store/plugins";
import { confirmDialog } from "@/store/confirm";
import { useKeys } from "@/store/keys";
import { t as tNow, useT, type MessageKey } from "@/store/i18n";
import {
  PLUGIN_CATEGORIES,
  type PluginCategory,
  type PluginInfo,
} from "@/types/plugins";
import { isKeylessProvider } from "@/lib/providers";
import { deleteApiKey, setApiKey } from "@/lib/keys";
import type { Provider } from "@/types/db";

/** i18n keys for the plugin category headings (replaces `CATEGORY_LABELS`
 *  at this render site so they translate live). */
const CATEGORY_KEYS: Record<PluginCategory, MessageKey> = {
  provider: "plugins.category.provider",
  theme: "plugins.category.theme",
  skill: "plugins.category.skill",
  "slash-command": "plugins.category.slashCommand",
  renderer: "plugins.category.renderer",
};

type Drafts = Partial<Record<Provider, string>>;

function ProviderPluginRow({ p }: { p: PluginInfo }) {
  const t = useT();
  const setEnabled = usePlugins((s) => s.setEnabled);
  const uninstall = usePlugins((s) => s.uninstall);
  const { id, name, version, description, author } = p.manifest;

  // Get the provider contribution from this plugin
  const contributes = p.manifest.contributes as { id: string; keyHint: string } | undefined;
  const providerId = contributes?.id as Provider | undefined;

  // Get presence and loaded state from keys store
  const present = useKeys((s) => s.present);
  const keysLoaded = useKeys((s) => s.loaded);
  const setPresent = useKeys((s) => s.setPresent);

  const [drafts, setDrafts] = useState<Drafts>({});
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only show API key UI if this is a provider plugin with a valid provider id
  const showApiKey = p.manifest.category === "provider" && providerId && !isKeylessProvider(providerId);

  async function save(provider: Provider) {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    setBusy(provider);
    setError(null);
    try {
      await setApiKey(provider, key);
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

  const saved = keysLoaded && providerId ? present.has(providerId) : undefined;
  const draft = providerId ? (drafts[providerId as Provider] ?? "") : "";
  const isBusy = providerId ? busy === providerId : false;

  return (
    <div className="flex flex-col gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{name}</span>
            <span className="text-muted-foreground text-xs">v{version}</span>
            {p.source === "builtin" && (
              <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
                {t("common.builtIn")}
              </span>
            )}
          </div>
          {description && (
            <span className="text-muted-foreground text-xs">{description}</span>
          )}
          {author && (
            <span className="text-muted-foreground text-[11px]">
              {t("common.byAuthor", { author })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant={p.enabled ? "default" : "outline"}
            onClick={() => void setEnabled(id, !p.enabled)}
          >
            {p.enabled ? t("common.enabled") : t("common.disabled")}
          </Button>
          {p.source === "user" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void confirmDialog({
                  title: tNow("plugins.uninstallTitle", { name }),
                  confirmText: tNow("common.uninstall"),
                  destructive: true,
                }).then((ok) => {
                  if (ok) void uninstall(id);
                });
              }}
            >
              {t("common.uninstall")}
            </Button>
          )}
        </div>
      </div>
      {showApiKey && providerId && (
        <div className="flex flex-col gap-1.5 pl-1">
          <div className="flex items-center justify-between">
            <Label htmlFor={`key-${id}`}>API Key</Label>
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
              id={`key-${id}`}
              type="password"
              autoComplete="off"
              placeholder={
                saved ? t("apiKeys.storedPlaceholder") : contributes?.keyHint
              }
              value={draft}
              disabled={isBusy}
              onChange={(e) =>
                providerId && setDrafts((d) => ({ ...d, [providerId as Provider]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void save(providerId);
              }}
            />
            <Button
              size="sm"
              onClick={() => void save(providerId)}
              disabled={isBusy || draft.trim().length === 0}
            >
              {saved ? t("common.update") : t("common.save")}
            </Button>
            {saved && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void remove(providerId)}
                disabled={isBusy}
              >
                {t("common.remove")}
              </Button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-destructive text-sm pl-1">{error}</p>}
    </div>
  );
}

function PluginRow({ p }: { p: PluginInfo }) {
  const t = useT();
  const setEnabled = usePlugins((s) => s.setEnabled);
  const uninstall = usePlugins((s) => s.uninstall);
  const { id, name, version, description, author } = p.manifest;

  return (
    <div className="flex items-start justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-muted-foreground text-xs">v{version}</span>
          {p.source === "builtin" && (
            <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
              {t("common.builtIn")}
            </span>
          )}
        </div>
        {description && (
          <span className="text-muted-foreground text-xs">{description}</span>
        )}
        {author && (
          <span className="text-muted-foreground text-[11px]">
            {t("common.byAuthor", { author })}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant={p.enabled ? "default" : "outline"}
          onClick={() => void setEnabled(id, !p.enabled)}
        >
          {p.enabled ? t("common.enabled") : t("common.disabled")}
        </Button>
        {p.source === "user" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void confirmDialog({
                title: tNow("plugins.uninstallTitle", { name }),
                confirmText: tNow("common.uninstall"),
                destructive: true,
              }).then((ok) => {
                if (ok) void uninstall(id);
              });
            }}
          >
            {t("common.uninstall")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Plugins() {
  const t = useT();
  const plugins = usePlugins((s) => s.plugins);
  const loaded = usePlugins((s) => s.loaded);
  const error = usePlugins((s) => s.error);
  const load = usePlugins((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const byCategory = (cat: PluginCategory) =>
    plugins.filter((p) => p.manifest.category === cat);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("plugins.title")}</CardTitle>
        <CardDescription>{t("plugins.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!loaded && (
          <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
        )}
        {loaded &&
          // Themes are managed elsewhere (the theme toggle / appearance), so
          // the `theme` category is intentionally hidden from this list.
          PLUGIN_CATEGORIES.filter((cat) => cat !== "theme").map((cat) => {
            const items = byCategory(cat);
            return (
              <div key={cat} className="flex flex-col gap-1">
                <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  {t(CATEGORY_KEYS[cat])}
                </h3>
                {items.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {/* The category label is passed untransformed — casing
                        rules differ per language (German capitalizes nouns). */}
                    {t("plugins.noneInCategory", {
                      category: t(CATEGORY_KEYS[cat]),
                    })}
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {items.map((p) => (
                      // Use ProviderPluginRow for provider plugins to show API key input
                      p.manifest.category === "provider" ? (
                        <ProviderPluginRow key={p.manifest.id} p={p} />
                      ) : (
                        <PluginRow key={p.manifest.id} p={p} />
                      )
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
