import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePlugins } from "@/store/plugins";
import { confirmDialog } from "@/store/confirm";
import {
  CATEGORY_LABELS,
  PLUGIN_CATEGORIES,
  type PluginCategory,
  type PluginInfo,
} from "@/types/plugins";

function PluginRow({ p }: { p: PluginInfo }) {
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
              built-in
            </span>
          )}
        </div>
        {description && (
          <span className="text-muted-foreground text-xs">{description}</span>
        )}
        {author && (
          <span className="text-muted-foreground text-[11px]">by {author}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant={p.enabled ? "default" : "outline"}
          onClick={() => void setEnabled(id, !p.enabled)}
        >
          {p.enabled ? "Enabled" : "Disabled"}
        </Button>
        {p.source === "user" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void confirmDialog({
                title: `Uninstall "${name}"?`,
                confirmText: "Uninstall",
                destructive: true,
              }).then((ok) => {
                if (ok) void uninstall(id);
              });
            }}
          >
            Uninstall
          </Button>
        )}
      </div>
    </div>
  );
}

export function Plugins() {
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
        <CardTitle>Plugins</CardTitle>
        <CardDescription>
          Extend the app with providers, themes, skills, and slash commands.
          Built-in plugins ship with the app and can be disabled but not
          removed. User plugins live in the app data <code>plugins/</code>{" "}
          folder.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!loaded && <p className="text-muted-foreground text-sm">Loading…</p>}
        {loaded &&
          PLUGIN_CATEGORIES.map((cat) => {
            const items = byCategory(cat);
            return (
              <div key={cat} className="flex flex-col gap-1">
                <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  {CATEGORY_LABELS[cat]}
                </h3>
                {items.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No {CATEGORY_LABELS[cat].toLowerCase()} installed.
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {items.map((p) => (
                      <PluginRow key={p.manifest.id} p={p} />
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
