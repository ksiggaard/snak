import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTheme } from "@/store/theme";
import { selectRegistry, usePlugins } from "@/store/plugins";
import { useT } from "@/store/i18n";
import { themesDirectory, type InstalledTheme } from "@/lib/themes";

/**
 * Themes settings card (T11). Lists installable themes — folders dropped into
 * the app-data themes directory (loaded by Rust) **plus** any enabled `theme`
 * plugins from the T12 registry — and lets the user pick one. The selection
 * composes with the light/dark toggle (theme CSS only overrides the documented
 * variables). Plugin-contributed themes are folded in via a `plugin:`-prefixed
 * synthetic id so both sources share the one selector.
 */
export function Themes() {
  const t = useT();
  const installed = useTheme((s) => s.installed);
  const themeId = useTheme((s) => s.themeId);
  const loaded = useTheme((s) => s.loaded);
  const error = useTheme((s) => s.error);
  const loadInstalled = useTheme((s) => s.loadInstalled);
  const selectTheme = useTheme((s) => s.selectTheme);

  // Enabled `theme` contributions from the T12 plugin registry, mapped into the
  // same shape as folder themes so they share the selector and apply path.
  const loadPlugins = usePlugins((s) => s.load);
  // Select the stable `themes` array off the (memoized) registry, then map it
  // in a `useMemo`. Mapping *inside* the selector would return a fresh array on
  // every render → infinite re-render (the same bug that black-screened the
  // composer); see `selectRegistry`.
  const themeContributions = usePlugins((s) => selectRegistry(s).themes);
  const pluginThemes = useMemo(
    () =>
      themeContributions.map(
        (t, i): InstalledTheme => ({
          id: `plugin:${t.name}:${i}`,
          name: t.name,
          author: null,
          version: "",
          css: t.css,
        }),
      ),
    [themeContributions],
  );

  const [dir, setDir] = useState<string | null>(null);

  // Load plugins (registry source) then compose them into the theme list.
  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  // Re-compose the theme list whenever the set of plugin themes changes. A
  // stable key over the contributions keeps the dependency primitive.
  const pluginKey = pluginThemes
    .map((t) => `${t.id}=${t.css.length}`)
    .join("|");
  useEffect(() => {
    void loadInstalled(pluginThemes);
    // pluginThemes is recomputed each render; pluginKey captures its identity.
  }, [loadInstalled, pluginKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reveal() {
    setDir(await themesDirectory());
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("themes.title")}</CardTitle>
        <CardDescription>{t("themes.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!loaded && (
          <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
        )}

        {loaded && (
          <div className="flex flex-col">
            <ThemeRow
              name={t("themes.default")}
              meta={t("themes.defaultMeta")}
              selected={themeId === null}
              onSelect={() => selectTheme(null)}
            />
            {installed.map((theme) => (
              <ThemeRow
                key={theme.id}
                name={theme.name}
                meta={[
                  theme.version && `v${theme.version}`,
                  theme.author &&
                    t("common.byAuthor", { author: theme.author }),
                  theme.id.startsWith("plugin:") && t("themes.pluginBadge"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                selected={themeId === theme.id}
                onSelect={() => selectTheme(theme.id)}
              />
            ))}
            {installed.length === 0 && (
              <p className="text-muted-foreground py-2 text-sm">
                {t("themes.none")}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadInstalled(pluginThemes)}
          >
            {t("common.refresh")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void reveal()}>
            {t("themes.showFolder")}
          </Button>
        </div>
        {dir && (
          <p className="text-muted-foreground text-xs break-all">
            {t("themes.directory")} <code>{dir}</code>
          </p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ThemeRow({
  name,
  meta,
  selected,
  onSelect,
}: {
  name: string;
  meta?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        {meta && <span className="text-muted-foreground text-xs">{meta}</span>}
      </div>
      <Button
        size="sm"
        variant={selected ? "default" : "outline"}
        onClick={onSelect}
      >
        {selected ? t("common.active") : t("common.use")}
      </Button>
    </div>
  );
}
