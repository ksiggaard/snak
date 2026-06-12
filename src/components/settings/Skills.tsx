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
import { useT } from "@/store/i18n";
import type { PluginInfo, SkillContribution } from "@/types/plugins";

/**
 * Skills settings card (T15). Lists every `skill`-category plugin discovered by
 * the T12 host and lets the user enable/disable each one. Enabling a skill is
 * the existing plugin enable/disable (persisted backend-side), so this card is a
 * thin, skills-focused view over that state — the enabled skills' instructions
 * are then injected into the system context via `buildSkillsSystemText` in
 * `store/threads.ts`.
 */
function SkillRow({ p }: { p: PluginInfo }) {
  const t = useT();
  const setEnabled = usePlugins((s) => s.setEnabled);
  const { id, name, version, description } = p.manifest;
  const skill = p.manifest.contributes as SkillContribution | undefined;
  const skillName = skill?.name?.trim() || name;
  const preview = skill?.instructions?.trim() ?? "";

  return (
    <div className="flex items-start justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{skillName}</span>
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
        {preview && (
          <span className="text-muted-foreground line-clamp-2 text-xs">
            {preview}
          </span>
        )}
      </div>
      <Button
        size="sm"
        className="shrink-0"
        variant={p.enabled ? "default" : "outline"}
        onClick={() => void setEnabled(id, !p.enabled)}
      >
        {p.enabled ? t("common.enabled") : t("common.disabled")}
      </Button>
    </div>
  );
}

export function Skills() {
  const t = useT();
  const plugins = usePlugins((s) => s.plugins);
  const loaded = usePlugins((s) => s.loaded);
  const error = usePlugins((s) => s.error);
  const load = usePlugins((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const skills = plugins.filter((p) => p.manifest.category === "skill");

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("skills.title")}</CardTitle>
        <CardDescription>{t("skills.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {!loaded && (
          <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
        )}
        {loaded && skills.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("skills.none")}</p>
        )}
        {loaded && skills.map((p) => <SkillRow key={p.manifest.id} p={p} />)}
        {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
