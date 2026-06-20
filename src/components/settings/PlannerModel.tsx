import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useT } from "@/store/i18n";
import { useProviders, isKeylessProvider } from "@/lib/providers";
import { buildModelOptions } from "@/lib/modelOptions";
import { getSetting, setSetting } from "@/lib/db";
import { ModelChooser } from "@/components/chat/ModelChooser";
import { useEffect, useState } from "react";

/**
 * Planner model settings: the model that orchestrates complex multi-model tasks.
 * Also accepts free-text instructions fed to the planner's system prompt, so the
 * user can guide its delegation preferences (e.g. "use local models when possible").
 */
export function PlannerModel() {
  const t = useT();
  const plannerProvider = useThreads((s) => s.plannerProvider);
  const plannerModel = useThreads((s) => s.plannerModel);
  const setPlannerModel = useThreads((s) => s.setPlannerModel);
  const models = useModels((s) => s.models);
  const providers = useProviders();

  const [instructions, setInstructions] = useState("");
  const [instructionsLoaded, setInstructionsLoaded] = useState(false);

  useEffect(() => {
    void getSetting("planner_instructions").then((v) => {
      setInstructions(v ?? "");
      setInstructionsLoaded(true);
    });
  }, []);

  const saveInstructions = (value: string) => {
    setInstructions(value);
    void setSetting("planner_instructions", value);
  };

  // Count how many distinct providers have API keys (or are keyless).
  const keyedCount = providers.filter(
    (p) => isKeylessProvider(p.id),
  ).length;
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

        <div className="flex flex-col gap-2">
          <label htmlFor="planner-instructions" className="text-sm leading-tight">
            {t("planner.instructions")}
          </label>
          <Textarea
            id="planner-instructions"
            className="resize-y min-h-20"
            placeholder={t("planner.instructionsPlaceholder")}
            value={instructions}
            disabled={!instructionsLoaded}
            onChange={(e) => saveInstructions(e.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
