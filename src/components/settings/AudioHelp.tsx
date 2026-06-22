import { useEffect, useState } from "react";
import { ExternalLink, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/openExternal";
import { openInTerminal } from "@/lib/terminal";
import { useT } from "@/store/i18n";
import { cn } from "@/lib/utils";

type OS = "linux" | "mac" | "windows";

/** Default the tab to the user's platform (best-effort from the UA string). */
function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "windows";
  return "linux";
}

// Install commands per tool/OS. Commands are literal (shell text, exempt from
// i18n); a null command means "no one-liner — follow the docs link instead".
const PIPER_CMD: Record<OS, string> = {
  linux: "pipx install piper-tts",
  mac: "pipx install piper-tts",
  windows: "pipx install piper-tts",
};
const WHISPER_CMD: Record<OS, string | null> = {
  mac: "brew install whisper-cpp",
  linux: "brew install whisper-cpp",
  windows: null, // no official package — prebuilt release / source build
};

const PIPER_DOCS = "https://github.com/rhasspy/piper#installation";
const WHISPER_DOCS = "https://github.com/ggml-org/whisper.cpp#quick-start";

/**
 * "Getting started" modal for the audio plugin: per-OS instructions to install
 * Piper (TTS) and whisper.cpp (STT). Follows the ConfirmDialog overlay pattern
 * (click-outside / Escape to close). Install one-liners can be staged into a
 * terminal (never auto-run — same safety model as the rest of the card).
 */
export function AudioHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [os, setOs] = useState<OS>(detectOS);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs: { id: OS; label: string }[] = [
    { id: "linux", label: t("audio.osLinux") },
    { id: "mac", label: t("audio.osMac") },
    { id: "windows", label: t("audio.osWindows") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("audio.helpTitle")}
        className="bg-background flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div>
            <h2 className="text-base font-semibold">{t("audio.helpTitle")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("audio.helpIntro")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="hover:bg-muted text-muted-foreground shrink-0 rounded p-1"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* OS selector */}
        <div className="flex gap-1 px-5 pt-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setOs(tab.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                os === tab.id
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          <ToolSetup
            heading={t("audio.helpPiperHeading")}
            note={t("audio.helpPiperNote")}
            command={PIPER_CMD[os]}
            docsHref={PIPER_DOCS}
          />
          <ToolSetup
            heading={t("audio.helpWhisperHeading")}
            note={
              os === "windows"
                ? t("audio.helpWhisperNoteWindows")
                : t("audio.helpWhisperNote")
            }
            command={WHISPER_CMD[os]}
            docsHref={WHISPER_DOCS}
          />

          <p className="text-muted-foreground border-t pt-4 text-sm">
            {t("audio.helpPathHint")}
          </p>
          <p className="text-sm">{t("audio.helpAfter")}</p>
        </div>

        <div className="flex justify-end border-t p-4">
          <Button size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToolSetup({
  heading,
  note,
  command,
  docsHref,
}: {
  heading: string;
  note: string;
  command: string | null;
  docsHref: string;
}) {
  const t = useT();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{heading}</h3>
      <p className="text-muted-foreground text-sm">{note}</p>
      {command && (
        <div className="flex items-center gap-2">
          <code className="bg-muted flex-1 truncate rounded px-2 py-1.5 font-mono text-xs">
            {command}
          </code>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            onClick={() => void openInTerminal(command)}
          >
            <TerminalSquare className="size-3.5" />
            {t("audio.helpStage")}
          </Button>
        </div>
      )}
      <button
        type="button"
        onClick={() => void openExternal(docsHref)}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs underline underline-offset-2"
      >
        <ExternalLink className="size-3" />
        {t("audio.helpDocs")}
      </button>
    </section>
  );
}
