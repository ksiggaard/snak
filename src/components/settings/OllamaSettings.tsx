import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  formatBytes,
  isValidOllamaModelName,
  ollamaPullCommand,
  SUGGESTED_MODELS,
} from "@/lib/ollama";
import { openInTerminal } from "@/lib/terminal";
import { useOllama } from "@/store/ollama";
import { useT } from "@/store/i18n";

/**
 * Local (Ollama) settings card (T37): daemon status + setup instructions when
 * it's down, the installed-model list when it's up, and a "pull a model" row
 * that *stages* `ollama pull <name>` in an OS terminal (T17 — pre-typed, never
 * auto-run; the user confirms with Enter there, then refreshes here).
 */
export function OllamaSettings() {
  const t = useT();
  const status = useOllama((s) => s.status);
  const version = useOllama((s) => s.version);
  const models = useOllama((s) => s.models);
  const running = useOllama((s) => s.running);
  const refreshing = useOllama((s) => s.refreshing);
  const starting = useOllama((s) => s.starting);
  const controlError = useOllama((s) => s.error);
  const refresh = useOllama((s) => s.refresh);
  const start = useOllama((s) => s.start);
  const unload = useOllama((s) => s.unload);

  const [pullDraft, setPullDraft] = useState("");
  const [staged, setStaged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pullName = pullDraft.trim();
  const pullValid = isValidOllamaModelName(pullName);

  async function stage(name: string) {
    setError(null);
    setStaged(null);
    try {
      await openInTerminal(ollamaPullCommand(name));
      setStaged(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function stagePull() {
    if (!pullValid) return;
    await stage(pullName);
    setPullDraft("");
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("ollama.title")}</CardTitle>
        <CardDescription>{t("ollama.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm">
            {refreshing || status === "unknown" ? (
              <span className="text-muted-foreground">
                {t("ollama.statusChecking")}
              </span>
            ) : status === "ok" ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                {t("ollama.statusRunning", { version: version ?? "?" })}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {t("ollama.statusDown")}
              </span>
            )}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? t("common.loading") : t("common.refresh")}
          </Button>
        </div>

        {(status === "down" || starting) && !refreshing && (
          <div className="flex flex-col gap-2 border-t pt-3 text-sm">
            <div className="flex items-center gap-2">
              {/* One-click start: spawns `ollama serve` (T41), then polls until
                  the daemon answers. Falls back to the manual steps below if
                  Ollama isn't installed. */}
              <Button
                size="sm"
                disabled={starting}
                onClick={() => void start()}
              >
                {starting ? t("ollama.starting") : t("ollama.start")}
              </Button>
              <span className="text-muted-foreground text-xs">
                {t("ollama.startHint")}
              </span>
            </div>
            <p className="text-muted-foreground">{t("ollama.setupIntro")}</p>
            <ol className="text-muted-foreground flex list-decimal flex-col gap-1 pl-5">
              <li>
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline underline-offset-2"
                >
                  {t("ollama.setupInstall")}
                </a>
              </li>
              <li>
                {t("ollama.setupStart")}{" "}
                <code className="bg-muted rounded px-1 font-mono text-xs">
                  ollama serve
                </code>
              </li>
              <li>
                {t("ollama.setupPull")}{" "}
                <code className="bg-muted rounded px-1 font-mono text-xs">
                  ollama pull llama3.2:1b
                </code>
              </li>
            </ol>
          </div>
        )}

        {controlError && (
          <p className="text-destructive text-sm">{controlError}</p>
        )}

        {status === "ok" && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t("ollama.installedModels")}
            </span>
            {models.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("ollama.noModels")}
              </p>
            ) : (
              <>
                {models.map((m) => (
                  <div key={m.name} className="flex items-center gap-2">
                    <span className="flex-1 truncate font-mono text-sm">
                      {m.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatBytes(m.size)}
                    </span>
                  </div>
                ))}
                <p className="text-muted-foreground text-xs">
                  {t("ollama.modelsHint")}
                </p>
              </>
            )}
          </div>
        )}

        {status === "ok" && running.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t("ollama.loadedModels")}
            </span>
            {running.map((m) => (
              <div key={m.name} className="flex items-center gap-2">
                <span className="flex-1 truncate font-mono text-sm">
                  {m.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t("ollama.inMemory", { size: formatBytes(m.size_vram) })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => void unload(m.name)}
                >
                  {t("ollama.unload")}
                </Button>
              </div>
            ))}
            <p className="text-muted-foreground text-xs">
              {t("ollama.loadedHint")}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-3">
          <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {t("ollama.pullLabel")}
          </span>
          <div className="flex gap-2">
            <Input
              value={pullDraft}
              onChange={(e) => setPullDraft(e.target.value)}
              placeholder={t("ollama.pullPlaceholder")}
              className="h-8 font-mono text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") void stagePull();
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!pullValid}
              onClick={() => void stagePull()}
            >
              {t("ollama.pullStage")}
            </Button>
          </div>
          {/* Curated one-click suggestions (T41), incl. a Hugging Face GGUF.
              Each stages its own `ollama pull` for review (never auto-run). */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              {t("ollama.suggestedLabel")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_MODELS.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  title={`${s.name} — ${s.note}`}
                  onClick={() => void stage(s.name)}
                  className="bg-muted/40 hover:bg-muted rounded-md border px-2 py-1 font-mono text-xs transition-colors"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          {pullName.length > 0 && !pullValid && (
            <p className="text-destructive text-xs">
              {t("ollama.pullInvalidName")}
            </p>
          )}
          {staged && (
            <p className="text-muted-foreground text-xs">
              {t("ollama.pullStagedHint", { name: staged })}
            </p>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
