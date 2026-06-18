import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useKeys } from "@/store/keys";
import { useT } from "@/store/i18n";
import { useProviders, isKeylessProvider } from "@/lib/providers";
import { buildModelOptions } from "@/lib/modelOptions";
import { ModelChooser } from "@/components/chat/ModelChooser";

/**
 * Planner model settings: the model that orchestrates complex multi-model tasks.
 * A planner is only useful when at least two distinct models are available —
 * otherwise a notice is shown instead.
 */
export function PlannerModel() {
  const t = useT();
  const plannerProvider = useThreads((s) => s.plannerProvider);
  const plannerModel = useThreads((s) => s.plannerModel);
  const plannerDefault = useThreads((s) => s.plannerDefault);
  const setPlannerModel = useThreads((s) => s.setPlannerModel);
  const setPlannerDefault = useThreads((s) => s.setPlannerDefault);
  const models = useModels((s) => s.models);
  const providers = useProviders();
  const present = useKeys((s) => s.present);
  const keysLoaded = useKeys((s) => s.loaded);

  // Count how many distinct providers have API keys (or are keyless).
  const keyedCount = keysLoaded
    ? providers.filter(
        (p) => isKeylessProvider(p.id) || present.has(p.id),
      ).length
    : 0;
  const hasEnoughModels = keyedCount >= 2;

  // All enabled providers count as selectable (not filtered by API key), so the
  // user can pick a planner model even if the key isn't saved yet.
  const allEnabled = new Set(providers.map((p) => p.id));
  const options = buildModelOptions(providers, allEnabled, models, {
    provider: plannerProvider,
    model: plannerModel,
  });

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl overflow-visible">
      <CardHeader>
        <CardTitle>{t("planner.title")}</CardTitle>
        <CardDescription>{t("planner.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("defaultModel.none")}
          </p>
        ) : (
          <ModelChooser
            provider={plannerProvider}
            model={plannerModel}
            onSelect={(p, m) => void setPlannerModel(p, m)}
            keyed={allEnabled}
            align="start"
          />
        )}

        {!hasEnoughModels && (
          <p className="text-muted-foreground text-xs">
            {t("planner.needsMoreModels")}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="planner-default"
            className="text-sm leading-tight"
          >
            {t("planner.defaultToggle")}
          </label>
          <Switch
            id="planner-default"
            checked={plannerDefault}
            onCheckedChange={(v) => void setPlannerDefault(v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
