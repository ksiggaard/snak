import { useEffect, useState } from "react";
import { Check, HelpCircle, RefreshCw } from "lucide-react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AudioHelp } from "@/components/settings/AudioHelp";
import {
  DEFAULT_STT_MODEL,
  DEFAULT_TTS_VOICE,
  PIPER_VOICES,
  WHISPER_MODELS,
  piperVoiceInstallCommand,
  whisperModelInstallCommand,
} from "@/lib/audioModels";
import { openInTerminal } from "@/lib/terminal";
import { useAudio } from "@/store/audio";
import { selectRegistry, usePlugins } from "@/store/plugins";
import { audioEnabled } from "@/lib/plugins";
import { useT } from "@/store/i18n";
import { cn } from "@/lib/utils";

/**
 * Audio plugin settings (TTS via Piper, STT via whisper.cpp). Mirrors the Ollama
 * card: tool-availability status, a model picker, and per-model "stage download"
 * buttons that pre-type a `curl` into a terminal (never auto-run). Selections
 * persist in the settings table and are read by the chat mic / speak buttons.
 */
export function Audio() {
  const t = useT();
  const enabled = usePlugins((s) => audioEnabled(selectRegistry(s)));
  const status = useAudio((s) => s.status);
  const loaded = useAudio((s) => s.loaded);
  const ttsVoice = useAudio((s) => s.ttsVoice);
  const sttModel = useAudio((s) => s.sttModel);
  const load = useAudio((s) => s.load);
  const refreshStatus = useAudio((s) => s.refreshStatus);
  const setTtsVoice = useAudio((s) => s.setTtsVoice);
  const setSttModel = useAudio((s) => s.setSttModel);

  const [piperDir, setPiperDir] = useState("");
  const [whisperDir, setWhisperDir] = useState("");
  const [staged, setStaged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    void load();
    void (async () => {
      const base = await appDataDir();
      setPiperDir(await join(base, "audio", "piper"));
      setWhisperDir(await join(base, "audio", "whisper"));
    })();
  }, [load]);

  const installedVoices = new Set(status?.voices ?? []);
  const installedModels = new Set(status?.stt_models ?? []);

  async function stage(label: string, command: string) {
    setError(null);
    setStaged(null);
    try {
      await openInTerminal(command);
      setStaged(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl">
      {helpOpen && <AudioHelp onClose={() => setHelpOpen(false)} />}
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t("audio.title")}</CardTitle>
            <CardDescription>{t("audio.description")}</CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setHelpOpen(true)}
          >
            <HelpCircle className="size-3.5" />
            {t("audio.help")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!enabled && (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
            {t("audio.pluginDisabled")}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            {t("audio.modelDirHint")}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!loaded}
            onClick={() => void refreshStatus()}
          >
            <RefreshCw className="size-3.5" />
            {t("common.refresh")}
          </Button>
        </div>

        {/* Text-to-Speech (Piper) */}
        <section className="flex flex-col gap-2 border-t pt-3">
          <h3 className="text-sm font-semibold">{t("audio.ttsSection")}</h3>
          <ToolStatus
            ok={status?.piper_installed ?? false}
            okText={t("audio.piperInstalled")}
            missingText={t("audio.piperMissing")}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("audio.ttsModel")}</span>
            <select
              value={ttsVoice}
              onChange={(e) => void setTtsVoice(e.target.value)}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              {PIPER_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.size})
                  {v.id === DEFAULT_TTS_VOICE ? ` — ${t("audio.default")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <ModelInstallRows
            items={PIPER_VOICES}
            installed={installedVoices}
            selectedId={ttsVoice}
            onStage={(v) => stage(v.id, piperVoiceInstallCommand(piperDir, v))}
            installedLabel={t("audio.installed")}
            stageLabel={t("audio.stageDownload")}
          />
        </section>

        {/* Speech-to-Text (whisper.cpp) */}
        <section className="flex flex-col gap-2 border-t pt-3">
          <h3 className="text-sm font-semibold">{t("audio.sttSection")}</h3>
          <ToolStatus
            ok={status?.whisper_installed ?? false}
            okText={t("audio.whisperInstalled")}
            missingText={t("audio.whisperMissing")}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("audio.sttModel")}</span>
            <select
              value={sttModel}
              onChange={(e) => void setSttModel(e.target.value)}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.size})
                  {m.id === DEFAULT_STT_MODEL ? ` — ${t("audio.default")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <ModelInstallRows
            items={WHISPER_MODELS}
            installed={installedModels}
            selectedId={sttModel}
            onStage={(m) =>
              stage(m.id, whisperModelInstallCommand(whisperDir, m))
            }
            installedLabel={t("audio.installed")}
            stageLabel={t("audio.stageDownload")}
          />
        </section>

        {staged && (
          <p className="text-muted-foreground text-xs">
            {t("audio.stagedHint", { name: staged })}
          </p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ToolStatus({
  ok,
  okText,
  missingText,
}: {
  ok: boolean;
  okText: string;
  missingText: string;
}) {
  return (
    <span
      className={cn(
        "text-xs",
        ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
      )}
    >
      {ok ? okText : missingText}
    </span>
  );
}

interface ModelLike {
  id: string;
  label: string;
  size: string;
}

function ModelInstallRows<T extends ModelLike>({
  items,
  installed,
  selectedId,
  onStage,
  installedLabel,
  stageLabel,
}: {
  items: T[];
  installed: Set<string>;
  selectedId: string;
  onStage: (item: T) => void;
  installedLabel: string;
  stageLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => {
        const isInstalled = installed.has(item.id);
        return (
          <div
            key={item.id}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
              item.id === selectedId && "bg-muted/50",
            )}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {isInstalled ? (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                {installedLabel}
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => onStage(item)}
              >
                {stageLabel}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
