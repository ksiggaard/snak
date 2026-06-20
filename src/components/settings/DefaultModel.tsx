import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useT } from "@/store/i18n";
import { useProviders } from "@/lib/providers";
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
import { ModelChooser } from "@/components/chat/ModelChooser";

/**
 * Default-model settings: the provider+model new chats (and the quick-input
 * overlay) start from. Picks from the configured model list (Settings →
 * Models). Key-agnostic — you may set a default before adding the key — so it
 * lists all configured models for enabled providers.
 *
 * The Planner entry at the top of the dropdown lets the user set planner
 * mode as the default for new chats. Selecting it persists the planner
 * provider/model as the default and sets planner as the preferred mode.
 */
export function DefaultModel() {
  const t = useT();
  const provider = useThreads((s) => s.defaultProvider);
  const model = useThreads((s) => s.defaultModel);
  const setDefaultModel = useThreads((s) => s.setDefaultModel);
  const plannerProvider = useThreads((s) => s.plannerProvider);
  const plannerModel = useThreads((s) => s.plannerModel);
  const plannerDefault = useThreads((s) => s.plannerDefault);
  const setPlannerDefault = useThreads((s) => s.setPlannerDefault);
  const models = useModels((s) => s.models);
  const providers = useProviders();

  // All enabled providers count as selectable here (not filtered by API key).
  const allEnabled = new Set(providers.map((p) => p.id));
  const options = buildModelOptions(providers, allEnabled, models, {
    provider,
    model,
  });

  const handleSelectDirect = (p: typeof provider, m: string) => {
    void setPlannerDefault(false);
    void setDefaultModel(p, m);
  };

  const handleSelectPlanner = () => {
    void setPlannerDefault(true);
    void setDefaultModel(plannerProvider, plannerModel);
  };

  const { providerLabel: plannerProviderLabel, label: plannerModelLabel } =
    currentModelLabel(providers, models, plannerProvider, plannerModel);

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl overflow-visible">
      <CardHeader>
        <CardTitle>{t("defaultModel.title")}</CardTitle>
        <CardDescription>{t("defaultModel.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("defaultModel.none")}
          </p>
        ) : (
          <ModelChooser
            provider={provider}
            model={model}
            onSelect={handleSelectDirect}
            keyed={allEnabled}
            align="start"
            plannerEntry={{
              active: plannerDefault,
              providerLabel: plannerProviderLabel,
              modelLabel: plannerModelLabel,
              onSelect: handleSelectPlanner,
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
