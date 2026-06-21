import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useKeys } from "@/store/keys";
import { useT } from "@/store/i18n";
import { useProviders, isKeylessProvider } from "@/lib/providers";
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
import { getSetting, setSetting } from "@/lib/db";
import { ModelChooser } from "@/components/chat/ModelChooser";
import {
  PLANNER_CAPABILITIES,
  type PlannerModelConfig,
} from "@/lib/planner";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import type { Provider } from "@/types/db";

/**
 * Planner model settings: the model that orchestrates complex multi-model tasks.
 * Also accepts free-text instructions fed to the planner's system prompt, so the
 * user can guide its delegation preferences (e.g. "use local models when possible").
 * The "Allowed models" section lets the user restrict which models the planner can
 * use and tag their capabilities so the planner can match models to subtask needs.
 */
export function PlannerModel() {
  const t = useT();
  const plannerProvider = useThreads((s) => s.plannerProvider);
  const plannerModel = useThreads((s) => s.plannerModel);
  const setPlannerModel = useThreads((s) => s.setPlannerModel);
  const criticProvider = useThreads((s) => s.criticProvider);
  const criticModel = useThreads((s) => s.criticModel);
  const setCriticModel = useThreads((s) => s.setCriticModel);
  const models = useModels((s) => s.models);
  const providers = useProviders();
  const keyed = useKeys((s) => s.present);
  const hasKey = (p: Provider) => isKeylessProvider(p) || keyed.has(p);

  const [instructions, setInstructions] = useState("");
  const [instructionsLoaded, setInstructionsLoaded] = useState(false);

  // Per-model config: key = "provider::model_id"
  const [config, setConfig] = useState<PlannerModelConfig>({});
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    void getSetting("planner_instructions").then((v) => {
      setInstructions(v ?? "");
      setInstructionsLoaded(true);
    });
  }, []);

  useEffect(() => {
    void getSetting("planner_model_config").then((raw) => {
      if (raw) {
        try {
          setConfig(JSON.parse(raw) as PlannerModelConfig);
        } catch {
          /* ignore */
        }
      }
      setConfigLoaded(true);
    });
  }, []);

  const saveInstructions = (value: string) => {
    setInstructions(value);
    void setSetting("planner_instructions", value);
  };

  const saveConfig = (next: PlannerModelConfig) => {
    setConfig(next);
    void setSetting("planner_model_config", JSON.stringify(next));
  };

  const toggleEnabled = (key: string) => {
    const cur = config[key];
    const next = { ...config, [key]: { ...cur, enabled: cur?.enabled !== true } };
    saveConfig(next);
  };

  const toggleCapability = (key: string, capId: string) => {
    const cur = config[key] ?? {};
    const caps = cur.capabilities ?? [];
    const nextCaps = caps.includes(capId)
      ? caps.filter((c) => c !== capId)
      : [...caps, capId];
    const next = { ...config, [key]: { ...cur, capabilities: nextCaps } };
    saveConfig(next);
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

  // Critic uses planner model when not explicitly set.
  const effectiveCriticProvider: Provider = criticProvider ?? plannerProvider;
  const effectiveCriticModel = criticModel ?? plannerModel;
  const isCriticExplicit = criticProvider !== null && criticModel !== null;
  const criticOptions = buildModelOptions(providers, allEnabled, models, {
    provider: effectiveCriticProvider,
    model: effectiveCriticModel,
  });
  const { label: criticModelLabel } = currentModelLabel(
    providers,
    models,
    effectiveCriticProvider,
    effectiveCriticModel,
  );

  const anyEnabled =
    Object.values(config).some((c) => c.enabled === true);
  const emptyConfig = Object.keys(config).length === 0;

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

        {/* Critic model */}
        <div className="flex flex-col gap-2">
          <label className="text-sm leading-tight">
            {t("planner.criticLabel")}
          </label>
          {criticOptions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("defaultModel.none")}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ModelChooser
                  provider={effectiveCriticProvider}
                  model={effectiveCriticModel}
                  onSelect={(p, m) => void setCriticModel(p, m)}
                  keyed={allEnabled}
                  align="start"
                />
              </div>
              {isCriticExplicit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void setCriticModel(null, null)}
                >
                  {t("planner.criticReset")}
                </Button>
              )}
            </div>
          )}
          {!isCriticExplicit && (
            <p className="text-muted-foreground text-xs">
              {t("planner.criticFallback", { model: criticModelLabel })}
            </p>
          )}
        </div>

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

        {/* Allowed models */}
        {configLoaded && models.length > 0 && (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-sm leading-tight font-medium">
                {t("planner.allowedModels")}
              </label>
              {!anyEnabled && emptyConfig && (
                <p className="text-muted-foreground text-xs mt-0.5">
                  {t("planner.allowedModelsHint")}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {models
                .filter((m) => hasKey(m.provider))
                .map((m) => {
                const key = `${m.provider}::${m.model_id}`;
                const entry = config[key];
                const enabled = entry?.enabled === true;
                const caps = entry?.capabilities ?? [];
                const p = providers.find((pm) => pm.id === m.provider);
                const providerLabel = p?.label ?? m.provider;
                return (
                  <div
                    key={key}
                    className="border-border bg-background/50 rounded-md border px-3 py-2.5 flex flex-col gap-2"
                  >
                    {/* Top row: toggle + model label */}
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={enabled}
                        onCheckedChange={() => toggleEnabled(key)}
                        aria-label={`${t("planner.allowedModels")} — ${providerLabel} · ${m.label}`}
                      />
                      <span
                        className={cn(
                          "text-sm flex-1 truncate",
                          !enabled && "text-muted-foreground line-through",
                        )}
                      >
                        {providerLabel} · {m.label}
                      </span>
                    </div>
                    {/* Capability chips */}
                    <div className="flex flex-wrap gap-1">
                      {PLANNER_CAPABILITIES.map((cap) => {
                        const active = caps.includes(cap.id);
                        return (
                          <Tooltip key={cap.id}>
                            <TooltipTrigger asChild>
                              <Toggle
                                size="sm"
                                variant="outline"
                                pressed={active}
                                disabled={!enabled}
                                onPressedChange={() =>
                                  toggleCapability(key, cap.id)
                                }
                                className="text-[0.7rem]"
                                aria-label={`${cap.label} — ${providerLabel} · ${m.label}`}
                              >
                                {cap.icon} {cap.label}
                              </Toggle>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {cap.label}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs">
              {t("planner.capabilityHint")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
