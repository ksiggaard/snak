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
import { chatStream } from "@/lib/chat";
import { ModelChooser } from "@/components/chat/ModelChooser";
import {
  PLANNER_CAPABILITIES,
  type PlannerModelConfig,
} from "@/lib/planner";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import type { Provider } from "@/types/db";

/** Trivial schema used to probe whether the planner model can produce structured
 *  JSON output — the core capability the planner depends on. */
const PROBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
} as const;

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

  // Critique rounds (0 disables the critic loop).
  const [criticRounds, setCriticRounds] = useState(2);
  const [criticRoundsLoaded, setCriticRoundsLoaded] = useState(false);

  // Lite mode for small/local planners (auto | on | off).
  const [liteMode, setLiteMode] = useState<"auto" | "on" | "off">("auto");
  const [liteModeLoaded, setLiteModeLoaded] = useState(false);

  // On-demand capability preflight for the chosen planner model.
  const [probe, setProbe] = useState<
    "idle" | "running" | "ok" | "weak" | "error"
  >("idle");
  // Reset the badge when the planner model changes. Render-time adjustment (not
  // a useEffect — the react-hooks/set-state-in-effect rule forbids the effect
  // form for syncing local state to a changing input).
  const plannerKey = `${plannerProvider}:${plannerModel}`;
  const [probedKey, setProbedKey] = useState(plannerKey);
  if (probedKey !== plannerKey) {
    setProbedKey(plannerKey);
    setProbe("idle");
  }

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

  useEffect(() => {
    void getSetting("planner_critic_rounds").then((raw) => {
      const n = raw ? parseInt(raw, 10) : 2;
      setCriticRounds(Number.isNaN(n) ? 2 : Math.max(0, Math.min(5, n)));
      setCriticRoundsLoaded(true);
    });
  }, []);

  useEffect(() => {
    void getSetting("planner_lite_mode").then((v) => {
      if (v === "on" || v === "off" || v === "auto") setLiteMode(v);
      setLiteModeLoaded(true);
    });
  }, []);

  const saveInstructions = (value: string) => {
    setInstructions(value);
    void setSetting("planner_instructions", value);
  };

  const saveCriticRounds = (value: number) => {
    const clamped = Math.max(0, Math.min(5, value));
    setCriticRounds(clamped);
    void setSetting("planner_critic_rounds", String(clamped));
  };

  const saveLiteMode = (value: "auto" | "on" | "off") => {
    setLiteMode(value);
    void setSetting("planner_lite_mode", value);
  };

  // Capability preflight: ask the planner model for a trivial structured JSON
  // reply and check it comes back valid. Tells the user up front whether the
  // model can drive the planner (vs. being usable only as a worker).
  async function runPreflight() {
    setProbe("running");
    try {
      const res = await chatStream(
        plannerProvider,
        plannerModel,
        [
          {
            role: "user",
            content: 'Reply with the JSON {"ok": true} and nothing else.',
            images: [],
          },
        ],
        () => {},
        "__preflight__",
        false, // deepResearch
        true, // skipTools
        undefined, // plannerModels
        PROBE_SCHEMA,
      );
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(res.content.trim());
      } catch {
        const m = res.content.match(/\{[\s\S]*?\}/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            /* leave null */
          }
        }
      }
      const ok =
        !!parsed && typeof (parsed as { ok?: unknown }).ok === "boolean";
      setProbe(ok ? "ok" : "weak");
    } catch {
      setProbe("error");
    }
  }

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
  const keyedCount = providers.filter((p) => hasKey(p.id)).length;
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

        {/* Capability preflight — does this model reliably produce structured plans? */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={probe === "running" || options.length === 0}
            onClick={() => void runPreflight()}
          >
            {probe === "running"
              ? t("planner.testRunning")
              : t("planner.testModel")}
          </Button>
          {probe === "ok" && (
            <span className="text-xs text-green-600 dark:text-green-400">
              ✓ {t("planner.testOk")}
            </span>
          )}
          {probe === "weak" && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ {t("planner.testWeak")}
            </span>
          )}
          {probe === "error" && (
            <span className="text-destructive text-xs">
              {t("planner.testError")}
            </span>
          )}
        </div>

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

        {/* Critique rounds */}
        <div className="flex flex-col gap-2">
          <label htmlFor="planner-critic-rounds" className="text-sm leading-tight">
            {t("planner.criticRounds")}
          </label>
          <select
            id="planner-critic-rounds"
            className="border-input bg-background h-9 w-20 rounded-md border px-2 text-sm"
            value={criticRounds}
            disabled={!criticRoundsLoaded}
            onChange={(e) => saveCriticRounds(parseInt(e.target.value, 10))}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            {t("planner.criticRoundsHint")}
          </p>
        </div>

        {/* Lite mode (small/local models) */}
        <div className="flex flex-col gap-2">
          <label htmlFor="planner-lite-mode" className="text-sm leading-tight">
            {t("planner.liteMode")}
          </label>
          <select
            id="planner-lite-mode"
            className="border-input bg-background h-9 w-44 rounded-md border px-2 text-sm"
            value={liteMode}
            disabled={!liteModeLoaded}
            onChange={(e) =>
              saveLiteMode(e.target.value as "auto" | "on" | "off")
            }
          >
            <option value="auto">{t("planner.liteAuto")}</option>
            <option value="on">{t("planner.liteOn")}</option>
            <option value="off">{t("planner.liteOff")}</option>
          </select>
          <p className="text-muted-foreground text-xs">
            {t("planner.liteModeHint")}
          </p>
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
