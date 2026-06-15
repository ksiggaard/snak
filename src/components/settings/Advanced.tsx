import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getCaptureReasoning,
  getCaptureTrace,
  getDeepResearchConcurrency,
  setCaptureReasoning,
  setCaptureTrace,
  setDeepResearchConcurrency,
  MAX_SUBAGENT_CONCURRENCY,
} from "@/lib/db";
import { useT } from "@/store/i18n";

/** Backend default (mirrors `research::DEFAULT_SUBAGENT_CONCURRENCY`). Shown as
 * the selected value when the user hasn't configured one. */
const DEFAULT_CONCURRENCY = 3;

/**
 * Advanced settings (T55): tunables that most users won't touch. Currently the
 * deep-research subagent concurrency — how many research subagents run at once.
 * Lower values are gentler on a provider's rate limit (the cause of 429s when
 * several subagents hit a thin tier together); higher values finish faster.
 */
export function Advanced() {
  const t = useT();
  const [value, setValue] = useState<number>(DEFAULT_CONCURRENCY);
  const [loaded, setLoaded] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [trace, setTrace] = useState(false);

  useEffect(() => {
    void (async () => {
      const [stored, r, tr] = await Promise.all([
        getDeepResearchConcurrency(),
        getCaptureReasoning(),
        getCaptureTrace(),
      ]);
      if (stored != null) setValue(stored);
      setReasoning(r);
      setTrace(tr);
      setLoaded(true);
    })();
  }, []);

  function update(n: number) {
    setValue(n);
    void setDeepResearchConcurrency(n);
  }

  function updateReasoning(on: boolean) {
    setReasoning(on);
    void setCaptureReasoning(on);
  }

  function updateTrace(on: boolean) {
    setTrace(on);
    void setCaptureTrace(on);
  }

  const options = Array.from(
    { length: MAX_SUBAGENT_CONCURRENCY },
    (_, i) => i + 1,
  );

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("advanced.title")}</CardTitle>
        <CardDescription>{t("advanced.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subagent-concurrency">
            {t("advanced.concurrencyLabel")}
          </Label>
          <select
            id="subagent-concurrency"
            value={value}
            disabled={!loaded}
            onChange={(e) => update(Number(e.target.value))}
            className="border-input bg-background h-9 w-32 rounded-md border px-2 text-sm"
          >
            {options.map((n) => (
              <option key={n} value={n}>
                {n}
                {n === DEFAULT_CONCURRENCY ? ` (${t("common.default")})` : ""}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-sm">
            {t("advanced.concurrencyHelp")}
          </p>
        </div>

        <div className="border-border/60 flex flex-col gap-4 border-t pt-4">
          <Label className="text-xs font-semibold tracking-wide uppercase opacity-70">
            {t("advanced.transparencyTitle")}
          </Label>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="capture-reasoning">
                {t("advanced.captureReasoningLabel")}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t("advanced.captureReasoningHelp")}
              </p>
            </div>
            <Switch
              id="capture-reasoning"
              checked={reasoning}
              disabled={!loaded}
              onCheckedChange={updateReasoning}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="capture-trace">
                {t("advanced.captureTraceLabel")}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t("advanced.captureTraceHelp")}
              </p>
            </div>
            <Switch
              id="capture-trace"
              checked={trace}
              disabled={!loaded}
              onCheckedChange={updateTrace}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
