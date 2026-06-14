import { useEffect, useMemo, useState } from "react";
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
import { useContextWindows } from "@/store/contextWindows";
import { useModels } from "@/store/models";
import { useT } from "@/store/i18n";

/**
 * T53 (IDEA 24) settings card: register a max context window (in tokens) per
 * model. When the active model has an entry, the composer's context readout
 * shows a `used / max (%)` usage bar; models without one just show an estimate.
 * Models are picked from the configured list so the keys match what's sent.
 */
export function ContextWindows() {
  const t = useT();
  const windows = useContextWindows((s) => s.windows);
  const loadWindows = useContextWindows((s) => s.load);
  const loaded = useContextWindows((s) => s.loaded);
  const setWindow = useContextWindows((s) => s.setWindow);
  const removeWindow = useContextWindows((s) => s.removeWindow);

  const models = useModels((s) => s.models);
  const modelsLoaded = useModels((s) => s.loaded);
  const loadModels = useModels((s) => s.load);

  const [newModel, setNewModel] = useState("");
  const [newMax, setNewMax] = useState("");

  useEffect(() => {
    if (!loaded) void loadWindows();
    if (!modelsLoaded) void loadModels();
  }, [loaded, loadWindows, modelsLoaded, loadModels]);

  // Friendly label for a model id (falls back to the id when unknown).
  const labelFor = useMemo(() => {
    const map = new Map(models.map((m) => [m.model_id, m.label]));
    return (id: string) => map.get(id) ?? id;
  }, [models]);

  // Configured models without an entry yet — offered in the add picker.
  const addable = useMemo(
    () =>
      models
        .filter((m) => !(m.model_id in windows))
        // de-dupe by model id (the same id can appear under providers)
        .filter((m, i, arr) => arr.findIndex((x) => x.model_id === m.model_id) === i),
    [models, windows],
  );

  function add() {
    const id = newModel.trim();
    const max = Number(newMax);
    if (!id || !Number.isFinite(max) || max <= 0) return;
    void setWindow(id, Math.round(max));
    setNewModel("");
    setNewMax("");
  }

  const entries = Object.entries(windows).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("contextWindows.title")}</CardTitle>
        <CardDescription>{t("contextWindows.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("contextWindows.empty")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map(([id, max]) => (
              <div key={id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm" title={id}>
                  {labelFor(id)}
                </span>
                <Input
                  type="number"
                  min={1}
                  className="w-32"
                  defaultValue={max}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) {
                      void setWindow(id, Math.round(v));
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void removeWindow(id)}
                >
                  {t("common.remove")}
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5 border-t pt-4">
          <Label>{t("contextWindows.addLabel")}</Label>
          <div className="flex items-center gap-2">
            {addable.length > 0 ? (
              <select
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 text-sm"
              >
                <option value="">{t("contextWindows.modelPlaceholder")}</option>
                {addable.map((m) => (
                  <option key={m.model_id} value={m.model_id}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                className="min-w-0 flex-1"
                placeholder={t("contextWindows.modelPlaceholder")}
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
              />
            )}
            <Input
              type="number"
              min={1}
              className="w-32"
              placeholder={t("contextWindows.maxTokens")}
              value={newMax}
              onChange={(e) => setNewMax(e.target.value)}
            />
            <Button onClick={add} disabled={!newModel.trim() || !newMax.trim()}>
              {t("common.add")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
